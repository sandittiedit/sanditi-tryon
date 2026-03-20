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

        // ==========================================================
        // STEP 1: GENERATE THE VISUAL IMAGE (Using the dedicated Image Model)
        // ==========================================================
        let imagePrompt = [];

        // MODE 1: VIRTUAL TRY-ON
        if (req.files['garmentImage']) {
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            const garmentImageBase64 = req.files['garmentImage'][0].buffer.toString("base64");

            imagePrompt = [
                { text: `ACT AS: Elite Luxury Virtual Fitting Room AI for Sanditi. TASK: Transfer the exact garment from Image 2 onto the customer in Image 1. CRITICAL CONSTRAINTS: 1. PERFECT FIT: Drape it realistically to match the height and posture in Image 1. 2. ZERO REDESIGN: Preserve the exact Pakistani-style digital prints, embroidery, kaftan drapes, and colors of Image 2. It must be identical. 3. PRESERVE USER: Keep the face and identity exactly the same. 4. ENVIRONMENT: Maintain the original background from Image 1.` },
                { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } },
                { inlineData: { mimeType: req.files['garmentImage'][0].mimetype, data: garmentImageBase64 } }
            ];
        } 
        // MODE 2: MOMENT GENERATION
        else if (customBackground) {
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            
            imagePrompt = [
                { text: `ACT AS: Luxury Fashion Photographer. TASK: Change the background of Image 1. CRITICAL CONSTRAINTS: 1. Do not change the person, their face, or their clothing. 2. Completely scrape and remove the old background. 3. Place them in a hyper-realistic setting matching this description: ${customBackground}.` },
                { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } }
            ];
        }

        // Call the specific Gemini Image Generation Model
        const imageResponse = await ai.models.generateContent({
            model: "gemini-3.1-flash-image", 
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
        // STEP 2: CALCULATE SMART SIZING (Only for Initial Try-On)
        // ==========================================================
        if (req.files['garmentImage'] && height !== "Unknown" && weight !== "Unknown") {
            const sizingResponse = await ai.models.generateContent({
                model: "gemini-3.1-flash-lite", // Fast, cheap text-only model
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

        // ==========================================================
        // STEP 3: SEND EVERYTHING BACK TO SHOPIFY
        // ==========================================================
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
