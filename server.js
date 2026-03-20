import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { GoogleGenAI, Type } from '@google/genai';

const app = express();
app.use(cors()); 
app.use(express.json());

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 } 
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.post('/api/try-on', upload.fields([{ name: 'userImage' }, { name: 'garmentImage' }]), async (req, res) => {
    console.log("🚀 [SERVER] New request received");
    
    try {
        const customBackground = req.body.backgroundPrompt; 
        const height = req.body.height || "Unknown";
        const weight = req.body.weight || "Unknown";
        
        let finalImageBase64 = null;
        let stylingData = {};

        if (req.files && req.files['garmentImage']) {
            console.log("📸 [SERVER] Mode 1: Virtual Try-On...");
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            const garmentImageBase64 = req.files['garmentImage'][0].buffer.toString("base64");

            // FIX 1: EXPLICIT CLOTHING SWAP PROMPT
            const imagePrompt = [
                { text: `VIRTUAL TRY-ON TASK. Image 1 is the customer. Image 2 is the garment. TASK: Redraw Image 1 so the customer is wearing the exact garment from Image 2. You MUST preserve the customer's exact face, identity, hair, and the original background from Image 1. Only the clothing should change to match Image 2.` },
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
                console.log("✅ [SERVER] Image generated!");
            } else {
                throw new Error("AI did not return image data.");
            }

            // FIX 2: COMBINED SIZING + UPSELL ENGINE
            console.log(`📏 [SERVER] Calculating size and styling...`);
            const sizingResponse = await ai.models.generateContent({
                model: "gemini-3.1-flash-lite-preview", 
                contents: [
                    { text: `Analyze the customer (Height: ${height}, Weight: ${weight}) and the garment. Return a valid JSON object with: "recommended_size" (XS, S, M, L, XL), "style_analysis" (1 sentence on how it suits them), and "upsells" (an array of 3 highly specific luxury accessories that match the outfit, each object having "name", "price" like "Rs. 2,500", and "reason"). DO NOT USE MARKDOWN TAGS. Return RAW JSON.` },
                    { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } },
                    { inlineData: { mimeType: req.files['garmentImage'][0].mimetype, data: garmentImageBase64 } }
                ],
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            recommended_size: { type: Type.STRING },
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

            try {
                // FIX 3: STRIP MARKDOWN THAT CRASHES JSON.PARSE
                let rawText = sizingResponse.text() || "{}";
                rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                stylingData = JSON.parse(rawText);
                console.log(`👕 [SERVER] Data Parsed Successfully!`);
            } catch (e) {
                console.error("❌ [SERVER] JSON parse failed.", e);
            }

        } else if (customBackground) {
            console.log(`🖼️ [SERVER] Mode 2: Generating Moment -> ${customBackground}`);
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            
            const imagePrompt = [
                { text: `BACKGROUND REPLACEMENT. Change the background to: ${customBackground}. The person, their clothing, and their face MUST remain 100% identical. Blend the lighting.` },
                { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } }
            ];

            const imageResponse = await ai.models.generateContent({
                model: "gemini-3.1-flash-image-preview", 
                contents: imagePrompt,
                config: { responseModalities: ["IMAGE"] }
            });

            const generatedPart = imageResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
            if (generatedPart?.inlineData) {
                finalImageBase64 = generatedPart.inlineData.data;
            }
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
