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

// Retry system ONLY for the heavy, premium Try-On model
async function generateTryOnWithRetry(imagePrompt, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const imageResponse = await ai.models.generateContent({
                // THE PREMIUM MODEL: Mandatory for flawless 2-image clothing swaps
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

        // ==========================================
        // MODE 1: THE INITIAL TRY-ON (PREMIUM MODEL)
        // ==========================================
        if (req.files && req.files['garmentImage']) {
            console.log("📸 [SERVER] Generating Virtual Try-On (Premium Model)...");
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            const garmentImageBase64 = req.files['garmentImage'][0].buffer.toString("base64");

            const imagePrompt = [
                { text: `VIRTUAL TRY-ON TASK. Image 1 is the customer. Image 2 is the target garment. TASK: CLOTHING SWAP. You MUST replace the clothing in Image 1 with the exact garment from Image 2. Preserve the customer's face, identity, hair, and the original background from Image 1, but the clothing MUST change perfectly to match Image 2.` },
                { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } },
                { inlineData: { mimeType: req.files['garmentImage'][0].mimetype, data: garmentImageBase64 } }
            ];

            const imageResponse = await generateTryOnWithRetry(imagePrompt);
            const generatedPart = imageResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
            if (generatedPart?.inlineData) {
                finalImageBase64 = generatedPart.inlineData.data;
            } else {
                throw new Error("AI did not return image data.");
            }

            // ==========================================
            // STYLING ADVICE (STRICT NO-BRAND-NAME RULE)
            // ==========================================
            console.log(`🛍️ [SERVER] Generating Styling Advice...`);
            try {
                const textResponse = await ai.models.generateContent({
                    model: "gemini-2.5-flash", 
                    contents: [
                        { text: `Analyze the garment in Image 2. Write a 3-sentence styling guide. Suggest specific styles of jewelry, handbags, and footwear that complement this outfit perfectly. CRITICAL RULE: DO NOT use any specific brand names (like Hermes, Bvlgari, Manolo, etc). Keep the descriptions elegant and generic (e.g., "a structured ecru leather tote" or "metallic espadrille wedges"). Return a valid JSON object with the exact key "style_advice".` },
                        { inlineData: { mimeType: req.files['garmentImage'][0].mimetype, data: garmentImageBase64 } }
                    ],
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: { style_advice: { type: Type.STRING } },
                            required: ["style_advice"]
                        }
                    }
                });

                let rawText = textResponse.text || "{}";
                rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                stylingData = JSON.parse(rawText);
                console.log("✅ [SERVER] Styling Data parsed successfully.");
            } catch (e) {
                console.error("❌ [SERVER] Styling engine error:", e.message);
            }

        } 
        // ==========================================
        // MODE 2: MOMENTS SWAP (CHEAP HYBRID MODEL)
        // ==========================================
        else if (customBackground && req.files && req.files['userImage']) {
            console.log(`🖼️ [SERVER] Generating Moment -> ${customBackground} (Cost-Saver Model)`);
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            
            const imagePrompt = [
                { text: `BACKGROUND REPLACEMENT. Change the background to: ${customBackground}. The person, their clothing, and their face MUST remain 100% identical. Blend the lighting seamlessly.` },
                { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } }
            ];

            // Calling the cheaper 2.5 flash image model directly to save your margins
            const imageResponse = await ai.models.generateContent({
                model: "gemini-2.5-flash-image",
                contents: imagePrompt,
                config: { responseModalities: ["IMAGE"] }
            });

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
