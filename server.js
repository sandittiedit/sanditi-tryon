import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { GoogleGenAI, Type } from '@google/genai';

const app = express();
app.use(cors()); 
app.use(express.json());

const upload = multer();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.post('/api/try-on', upload.fields([{ name: 'userImage' }, { name: 'garmentImage' }]), async (req, res) => {
    try {
        const customBackground = req.body.backgroundPrompt; 
        const height = req.body.height || "Unknown";
        const weight = req.body.weight || "Unknown";
        
        let finalImageBase64 = null;
        let finalRecommendedSize = null;

        let imagePrompt = [];

        // ==========================================================
        // MODE 1: THE INITIAL TRY-ON
        // ==========================================================
        if (req.files['garmentImage']) {
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            const garmentImageBase64 = req.files['garmentImage'][0].buffer.toString("base64");

            imagePrompt = [
                { text: `CRITICAL IMAGE EDITING TASK. You are a highly restricted image compositing tool. INPUT 1: The target garment. INPUT 2: The customer photo. MANDATORY RULES: 1. DO NOT generate a new person. You must use the exact face, hair, body shape, and posture of the customer in Input 2. 2. ONLY replace the clothing. Map the garment from Input 1 onto the customer. 3. Keep the original background of Input 2 untouched. 4. If you generate a different person, you have failed.` },
                { inlineData: { mimeType: req.files['garmentImage'][0].mimetype, data: garmentImageBase64 } },
                { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } }
            ];
        } 
        // ==========================================================
        // MODE 2: THE CHEAP MOMENT GENERATOR
        // ==========================================================
        else if (customBackground) {
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            
            imagePrompt = [
                { text: `CRITICAL BACKGROUND REPLACEMENT TASK. INPUT: A customer wearing a specific outfit. MANDATORY RULES: 1. DO NOT change the person in the foreground. Keep their face, expression, posture, and clothing 100% identical. DO NOT alter a single pixel of the human. 2. ONLY change the background. 3. Extract the foreground subject perfectly and place them ${customBackground}. 4. Match the environmental lighting to the new background seamlessly.` },
                { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } }
            ];
        }

        // Call the exact PREVIEW model that is working on your live app
        const imageResponse = await ai.models.generateContent({
            model: "gemini-3.1-flash-image-preview", 
            contents: imagePrompt,
            config: { responseModalities: ["IMAGE"] }
        });

        const generatedPart = imageResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (generatedPart?.inlineData) {
            finalImageBase64 = generatedPart.inlineData.data;
        } else {
            throw new Error("AI failed to generate visual data.");
        }

        // ==========================================================
        // STEP 2: CALCULATE SMART SIZING
        // ==========================================================
        if (req.files['garmentImage'] && height !== "Unknown" && weight !== "Unknown") {
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
            } catch (e) {
                console.error("Sizing JSON parse failed", e);
            }
        }

        res.json({ 
            imageBase64: finalImageBase64,
            recommendedSize: finalRecommendedSize
        });

    } catch (error) {
        console.error("Error from AI:", error);
        res.status(500).json({ error: "Failed to process request." });
    }
});

app.listen(process.env.PORT || 3000, () => console.log('Sanditi Try-On Server is running!'));
