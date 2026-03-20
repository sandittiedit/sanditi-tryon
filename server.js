import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { GoogleGenAI, Type } from '@google/genai';

const app = express();
app.use(cors()); 
app.use(express.json());

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } 
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generateImageWithRetry(imagePrompt, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const imageResponse = await ai.models.generateContent({
                model: "gemini-3.1-flash-image-preview", 
                contents: imagePrompt,
                config: { responseModalities: ["IMAGE"] }
            });
            return imageResponse;
        } catch (error) {
            if (error.status === 503 && attempt < maxRetries) {
                console.log(`⚠️ [SERVER] Google is busy (503). Retrying attempt ${attempt + 1}...`);
                await new Promise(resolve => setTimeout(resolve, 3000)); 
            } else {
                throw error;
            }
        }
    }
}

app.post('/api/try-on', upload.fields([{ name: 'userImage' }, { name: 'garmentImage' }]), async (req, res) => {
    console.log("🚀 [SERVER] New request received");
    
    try {
        const customBackground = req.body.backgroundPrompt; 
        let finalImageBase64 = null;
        let stylingData = {};

        // MODE 1: VIRTUAL TRY-ON & STYLING ADVICE
        if (req.files && req.files['garmentImage']) {
            console.log("📸 [SERVER] Generating Virtual Try-On...");
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            const garmentImageBase64 = req.files['garmentImage'][0].buffer.toString("base64");

            const imagePrompt = [
                { text: `VIRTUAL TRY-ON TASK. Image 1 is the customer. Image 2 is the target garment. TASK: Redraw Image 1 so the customer is wearing the exact garment from Image 2. MANDATORY: You MUST preserve the customer's exact face, identity, hair, and the original background from Image 1. Only the clothing should change. Do not hallucinate patterns.` },
                { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } },
                { inlineData: { mimeType: req.files['garmentImage'][0].mimetype, data: garmentImageBase64 } }
            ];

            const imageResponse = await generateImageWithRetry(imagePrompt);
            const generatedPart = imageResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
            if (generatedPart?.inlineData) {
                finalImageBase64 = generatedPart.inlineData.data;
            } else {
                throw new Error("AI did not return image data.");
            }

            // PURE STYLING ADVICE (NO FAKE PRODUCTS)
            console.log(`🛍️ [SERVER] Generating Styling Advice...`);
            try {
                const textResponse = await ai.models.generateContent({
                    model: "gemini-2.5-flash", 
                    contents: [
                        { text: `Analyze the garment in Image 2. Provide luxury fashion styling advice. Return a valid JSON object with exactly ONE key: "style_advice". The value must be a 2-3 sentence paragraph suggesting the ideal occasion, matching jewelry, makeup, and footwear for this outfit. RETURN ONLY RAW JSON.` },
                        { inlineData: { mimeType: req.files['garmentImage'][0].mimetype, data: garmentImageBase64 } }
                    ],
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: { style_advice: { type: Type.STRING } }
                        }
                    }
                });

                let rawText = textResponse.text || "{}";
                rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                stylingData = JSON.parse(rawText);
            } catch (e) {
                console.error("❌ [SERVER] Styling engine error:", e.message);
            }

        } 
        // MODE 2: MOMENTS BACKGROUND SWAP (Restored!)
        else if (customBackground && req.files && req.files['userImage']) {
            console.log(`🖼️ [SERVER] Generating Moment -> ${customBackground}`);
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            
            const imagePrompt = [
                { text: `BACKGROUND REPLACEMENT. Change the background to: ${customBackground}. The person, their clothing, and their face MUST remain 100% identical. Blend the lighting seamlessly.` },
                { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } }
            ];

            const imageResponse = await generateImageWithRetry(imagePrompt);
            const generatedPart = imageResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
            if (generatedPart?.inlineData) {
                finalImageBase64 = generatedPart.inlineData.data;
            } else {
                throw new Error("AI failed to create moment.");
            }
        } else {
            return res.status(400).json({ error: "Missing required inputs." });
        }

        console.log("📦 [SERVER] Sending final package to Shopify!");
        res.json({ imageBase64: finalImageBase64, ...stylingData });

    } catch (error) {
        console.error("❌ [SERVER] Fatal AI Error:", error);
        res.status(500).json({ error: "Failed to process request." });
    }
});

app.listen(process.env.PORT || 3000, () => console.log('✅ Sanditi Server Live!'));
