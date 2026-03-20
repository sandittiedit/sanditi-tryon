import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { GoogleGenAI, Type } from '@google/genai';

const app = express();
app.use(cors()); 
app.use(express.json());

// FIXED: Added strict memory limits so large phone photos don't crash your Render server
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 } // 8MB limit per file
});

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.post('/api/try-on', upload.fields([{ name: 'userImage' }, { name: 'garmentImage' }]), async (req, res) => {
    console.log("🚀 [SERVER] New request received from Shopify");
    
    try {
        const customBackground = req.body.backgroundPrompt; 
        const height = req.body.height || "Unknown";
        const weight = req.body.weight || "Unknown";
        
        let finalImageBase64 = null;
        let finalRecommendedSize = null;
        let imagePrompt = [];

        if (req.files && req.files['garmentImage']) {
            console.log("📸 [SERVER] Mode 1: Processing Virtual Try-On...");
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            const garmentImageBase64 = req.files['garmentImage'][0].buffer.toString("base64");

            imagePrompt = [
                { text: `CRITICAL IMAGE EDITING TASK. You are a highly restricted image compositing tool. INPUT 1: The target garment. INPUT 2: The customer photo. MANDATORY RULES: 1. DO NOT generate a new person. You must use the exact face, hair, body shape, and posture of the customer in Input 2. 2. ONLY replace the clothing. Map the garment from Input 1 onto the customer. 3. Keep the original background of Input 2 untouched. 4. If you generate a different person, you have failed.` },
                { inlineData: { mimeType: req.files['garmentImage'][0].mimetype, data: garmentImageBase64 } },
                { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } }
            ];
        } else if (customBackground) {
            console.log(`🖼️ [SERVER] Mode 2: Generating Moment -> ${customBackground}`);
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            
            imagePrompt = [
                { text: `CRITICAL BACKGROUND REPLACEMENT TASK. INPUT: A customer wearing a specific outfit. MANDATORY RULES: 1. DO NOT change the person in the foreground. Keep their face, expression, posture, and clothing 100% identical. DO NOT alter a single pixel of the human. 2. ONLY change the background. 3. Extract the foreground subject perfectly and place them ${customBackground}. 4. Match the environmental lighting to the new background seamlessly.` },
                { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } }
            ];
        } else {
            console.error("❌ [SERVER] Missing images. Aborting.");
            return res.status(400).json({ error: "Missing required images." });
        }

        console.log("⏳ [SERVER] Sending request to Google Gemini API...");
        const imageResponse = await ai.models.generateContent({
            model: "gemini-3.1-flash-image-preview", 
            contents: imagePrompt,
            config: { responseModalities: ["IMAGE"] }
        });

        const generatedPart = imageResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (generatedPart?.inlineData) {
            console.log("✅ [SERVER] Image generated successfully!");
            finalImageBase64 = generatedPart.inlineData.data;
        } else {
            throw new Error("AI did not return image data.");
        }

        if (req.files && req.files['garmentImage'] && height !== "Unknown" && weight !== "Unknown") {
            console.log(`📏 [SERVER] Calculating size for Height: ${height}, Weight: ${weight}...`);
            const sizingResponse = await ai.models.generateContent({
                model: "gemini-3.1-flash-lite-preview", 
                contents: `A customer shopping for modern Indian female garments is ${height} tall and weighs ${weight}. Based on standard luxury ethnic wear sizing (XS, S, M, L, XL, XXL), what is their most likely perfect size? Return ONLY a valid JSON object with the key "recommended_size" and the string value.`,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: { recommended_size: { type: Type.STRING } },
                        required: ["recommended_size"]
                    }
                }
            });

            try {
                const sizingResult = JSON.parse(sizingResponse.text());
                finalRecommendedSize = sizingResult.recommended_size;
                console.log(`👕 [SERVER] Recommended Size: ${finalRecommendedSize}`);
            } catch (e) {
                console.error("❌ [SERVER] Sizing failed to parse.");
            }
        }

        console.log("📦 [SERVER] Sending final package to Shopify!");
        res.json({ 
            imageBase64: finalImageBase64,
            recommendedSize: finalRecommendedSize
        });

    } catch (error) {
        console.error("❌ [SERVER] Fatal AI Error:", error);
        res.status(500).json({ error: "Failed to process request." });
    }
});

app.listen(process.env.PORT || 3000, () => console.log('✅ Sanditi Try-On Server is live!'));
