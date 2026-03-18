import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();
app.use(cors()); 
app.use(express.json());

const upload = multer();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const userLimits = {};

app.post('/api/try-on', upload.fields([{ name: 'userImage' }, { name: 'garmentImage' }]), async (req, res) => {
    const email = req.body.email; 

    if (!userLimits[email]) userLimits[email] = 0;
    if (userLimits[email] >= 5) {
        return res.status(403).json({ error: "You've reached your limit of 5 free try-ons!" });
    }

    try {
        console.log(`Processing try-on for: ${email}`);
        const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
        const garmentImageBase64 = req.files['garmentImage'][0].buffer.toString("base64");

        const prompt = [
            { text: "Realistically drape the garment from the second image onto the person in the first image. Maintain the fabric's natural drape, texture, and lighting." },
            { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } },
            { inlineData: { mimeType: req.files['garmentImage'][0].mimetype, data: garmentImageBase64 } }
        ];

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents: prompt,
            // CRITICAL FIX: You must tell the AI to output an image, otherwise it defaults to text.
            config: {
                responseModalities: ["IMAGE"] 
            }
        });

        const generatedImage = response.candidates[0].content.parts.find(part => part.inlineData);
        
        if (generatedImage) {
             userLimits[email]++; 
             res.json({ 
                 imageBase64: generatedImage.inlineData.data, 
                 count: userLimits[email] 
             });
        } else {
             res.status(500).json({ error: "AI didn't return an image."});
        }
    } catch (error) {
        console.error("Error from AI:", error);
        res.status(500).json({ error: "Failed to process image. Please try again." });
    }
});

app.listen(process.env.PORT || 3000, () => console.log('Sanditi Try-On Server is running!'));
