import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();
app.use(cors()); 
app.use(express.json());

const upload = multer();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.post('/api/try-on', upload.fields([{ name: 'userImage' }, { name: 'garmentImage' }]), async (req, res) => {
    try {
        const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
        const garmentImageBase64 = req.files['garmentImage'][0].buffer.toString("base64");
        const customBackground = req.body.backgroundPrompt; // For the "Moments" feature

        // THE HYPER-DETAILED VTON PROMPT
        let textPrompt = `You are an ultra-precise virtual fitting room AI. Your ONLY job is to transfer the garment from Image 2 onto the person in Image 1. 
        CRITICAL RULES:
        1. ZERO REDESIGN: You must flawlessly preserve every single detail of the garment in Image 2. Do not change the embroidery, print, colors, buttons, or fabric texture. 
        2. PERFECT FIT: Drape the garment realistically to match the exact height, body shape, and posture of the person in Image 1. Follow gravity and natural fabric folds.
        3. PRESERVE IDENTITY: Do not change the user's face, skin tone, or hair.`;

        // If a moment button was clicked, add the background instruction
        if (customBackground) {
            textPrompt += `\n4. ENVIRONMENT: Change the background behind the user to realistically match this setting: ${customBackground}. Integrate the lighting naturally.`;
        } else {
            textPrompt += `\n4. ENVIRONMENT: Keep the original background from Image 1 exactly the same.`;
        }

        const prompt = [
            { text: textPrompt },
            { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } },
            { inlineData: { mimeType: req.files['garmentImage'][0].mimetype, data: garmentImageBase64 } }
        ];

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents: prompt,
            config: {
                responseModalities: ["IMAGE"] 
            }
        });

        const generatedImage = response.candidates[0].content.parts.find(part => part.inlineData);
        
        if (generatedImage) {
             res.json({ imageBase64: generatedImage.inlineData.data });
        } else {
             res.status(500).json({ error: "AI didn't return an image."});
        }
    } catch (error) {
        console.error("Error from AI:", error);
        res.status(500).json({ error: "Failed to process image. Please try again." });
    }
});

app.listen(process.env.PORT || 3000, () => console.log('Sanditi Try-On Server is running!'));
