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

        //MODE 1: VIRTUAL TRY-ON (2 Images Received: Customer + Garment)
        if (req.files['garmentImage']) {
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            const garmentImageBase64 = req.files['garmentImage'][0].buffer.toString("base64");

            //--- HYPER-DETAILED, ZERO-HALLUCINATION VTON PROMPT ---
            let textPrompt = `You are an ultra-precise, state-of-the-art virtual fitting room AI for a high-end luxury brand. Your only job is to flawlessly transfer the garment from Image 2 onto the person in Image 1.
            
            CRITICAL RULES (ZERO DEVIATION ALLOWED):
            1. PIXEL-PERFECT CLOTHING: Image 2 is the non-negotiable definition of the garment. You must transfer every single detail. Do not change the embroidery, print pattern, colors, button placement, or the fabric's drape and texture. Preserve the neckline structure and sleeve width exactly. ZERO REDESIGN or "CREATIVITY."
            2. REALISTIC FIT & HEIGHT: Adjust the garment's fit according to the exact height and body type of the person in Image 1. It must look as if it was tailored for them. Match the scale perfectly. 
            3. PRESERVE IDENTITY: Do not change the face, skin tone, or hair of the person in Image 1. 
            4. DESTROY & REPLACE BACKGROUND: In order to ensure a perfect fit, first completely extract the customer and the new garment from their previous environments. Then, place them into a clean version of the Image 1 background. Remove ALL trace elements from the Image 1 background (like other objects, furniture, or distracting elements). The result must be hyper-realistic.`;

            prompt = [
                { text: textPrompt },
                { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } },
                { inlineData: { mimeType: req.files['garmentImage'][0].mimetype, data: garmentImageBase64 } }
            ];
        } 
        
        //MODE 2: CHEAPER, HYPER-TRANSPORT MOMENT MODE (1 Image Received: Generated Try-On Look + Text Prompt)
        else if (customBackground) {
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            
            //--- HYPER-DETAILED MOMENT PROMPT ---
            let textPrompt = `You are an ultra-professional photographer AI. Your job is to change the environment of this person.
            
            CRITICAL RULES:
            1. PIXEL-PERFECT SUBJECT: Maintain the person, their face, their hair, their skin tone, AND their specific luxury clothing EXACTLY as they appear in Image 1. ZERO CHANGES.
            2. SCRAPE & DESTROY BACKGROUND: You must completely and totally remove ALL elements of the original Image 1 background, including any furniture, buildings, vegetation, or trees. All trace elements must be scraped off. 
            3. CREATE NEW REALITY: Place the person, with zero changes to their appearance, into a hyper-realistic, super-detailed luxury background matching this setting: ${customBackground}. Integrate the new lighting naturally and precisely, matching the mood of the setting. If the setting (like a dark date night) requires, the AI may subtly optimize the subject's pose for realism while maintaining their core identity.`;

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
