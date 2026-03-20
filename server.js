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

app.post('/api/try-on', upload.fields([{ name: 'userImage' }, { name: 'garmentImage' }]), async (req, res) => {
    console.log("🚀 [SERVER] New request received");
    
    try {
        let finalImageBase64 = null;
        let stylingData = {};

        if (req.files && req.files['garmentImage']) {
            console.log("📸 [SERVER] Generating Virtual Try-On Image...");
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            const garmentImageBase64 = req.files['garmentImage'][0].buffer.toString("base64");

            // 1. GENERATE THE IMAGE 
            const imagePrompt = [
                { text: `VIRTUAL TRY-ON TASK. Image 1 is the customer. Image 2 is the target garment (luxury Sanditi Pakistani-style digital printed/embroidered co-ord or kaftan). TASK: Redraw Image 1 so the customer is wearing the exact garment from Image 2. MANDATORY: You MUST preserve the customer's exact face, identity, hair, and the original background from Image 1. Only the clothing should change. Do not hallucinate or change the patterns.` },
                { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } },
                { inlineData: { mimeType: req.files['garmentImage'][0].mimetype, data: garmentImageBase64 } }
            ];

            const imageResponse = await ai.models.generateContent({
                model: "gemini-3.1-flash-image-preview", 
                contents: imagePrompt,
                config: { responseModalities: ["IMAGE"] }
            });

            const generatedPart = imageResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
            if (generatedPart?.inlineData) {
                finalImageBase64 = generatedPart.inlineData.data;
            } else {
                throw new Error("AI did not return image data.");
            }

            // 2. GENERATE THE STYLING & UPSELL
            console.log(`🛍️ [SERVER] Generating Styling & Upsell Data...`);
            try {
                const textResponse = await ai.models.generateContent({
                    model: "gemini-2.5-flash", 
                    contents: [
                        { text: `Analyze the garment in Image 2. Return a valid JSON object with: "style_analysis" (1 elegant sentence on how to style this luxury Sanditi piece) and "upsells" (an array of exactly 3 highly specific luxury Indian accessories like "Polki Choker", "Velvet Potli" that match this outfit. Each object must have a "name", "price" like "Rs. 2,500", and a short "reason"). RETURN ONLY RAW JSON.` },
                        { inlineData: { mimeType: req.files['garmentImage'][0].mimetype, data: garmentImageBase64 } }
                    ],
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                style_analysis: { type: Type.STRING },
                                upsells: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: { name: { type: Type.STRING }, price: { type: Type.STRING }, reason: { type: Type.STRING } }
                                    }
                                }
                            }
                        }
                    }
                });

                // THE CRITICAL FIX: textResponse.text (property), not textResponse.text() (function)
                let rawText = textResponse.text || "{}";
                rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                stylingData = JSON.parse(rawText);
                console.log("✅ [SERVER] Styling Data parsed successfully!");
            } catch (e) {
                console.error("❌ [SERVER] Styling engine error:", e.message);
            }

        } else {
            return res.status(400).json({ error: "Missing required images." });
        }

        console.log("📦 [SERVER] Sending final package to Shopify!");
        res.json({ 
            imageBase64: finalImageBase64,
            ...stylingData
        });

    } catch (error) {
        console.error("❌ [SERVER] Fatal AI Error:", error);
        res.status(500).json({ error: "Failed to process request." });
    }
});

app.listen(process.env.PORT || 3000, () => console.log('✅ Sanditi Server Live!'));
