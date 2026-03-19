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
        const customBackground = req.body.backgroundPrompt; 
        
        let prompt = [];

        // MODE 1: VIRTUAL TRY-ON (2 Images Received)
        if (req.files['garmentImage']) {
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            const garmentImageBase64 = req.files['garmentImage'][0].buffer.toString("base64");

            let textPrompt = `You are a strict virtual fitting room AI. Your ONLY job is to transfer the garment from Image 2 onto the person in Image 1. 
            RULES:
            1. DO NOT REDESIGN: Preserve every single detail of the garment in Image 2. Exact embroidery, print, colors, and sleeves. 
            2. PERFECT FIT: Drape the garment realistically to match the exact body of the person in Image 1. 
            3. PRESERVE IDENTITY: Do not change the user's face, skin tone, or background.`;

            prompt = [
                { text: textPrompt },
                { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } },
                { inlineData: { mimeType: req.files['garmentImage'][0].mimetype, data: garmentImageBase64 } }
            ];
        } 
        
        // MODE 2: MOMENT GENERATION (1 Image + Text Prompt Received)
        // This is significantly cheaper because there is only 1 image input!
        else if (customBackground) {
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            
            let textPrompt = `You are a professional photographer AI. Your job is to change the background of this image.
            RULES:
            1. DO NOT touch the person, their face, their skin tone, or their clothing. Keep them EXACTLY the same.
            2. Change the background behind the person to realistically match this setting: ${customBackground}. 
            3. Integrate the lighting naturally.`;

            prompt = [
                { text: textPrompt },
                { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } }
            ];
        } else {
            return res.status(400).json({ error: "Missing required images or prompts." });
        }

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
