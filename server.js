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
        const height = req.body.height || "Unknown";
        const weight = req.body.weight || "Unknown";
        
        let prompt = [];

        // MODE 1: VIRTUAL TRY-ON & SIZE RECOMMENDATION
        if (req.files['garmentImage']) {
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            const garmentImageBase64 = req.files['garmentImage'][0].buffer.toString("base64");

            let textPrompt = `You are an elite master tailor and visual AI for Sanditi, a luxury Indian brand. 
            
            TASK 1 (Visual): Transfer the exact garment from Image 2 onto the person in Image 1.
            - ZERO HALLUCINATIONS: Do not alter the garment's print, embroidery, color, or structural design. It must be identical.
            - FIT: Drape it accurately on their body.
            - PRESERVE USER: Keep their face and identity exactly the same.
            
            TASK 2 (Sizing): The user is ${height} tall and weighs ${weight}. Based on their photo and these dimensions, calculate their perfect size (XS, S, M, L, or XL).
            
            OUTPUT FORMAT:
            You must return a valid JSON object with EXACTLY two keys:
            1. "recommended_size": The string value of the size (e.g., "M").
            2. "image_base64": The base64 string of the generated try-on image.`;

            prompt = [
                { text: textPrompt },
                { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } },
                { inlineData: { mimeType: req.files['garmentImage'][0].mimetype, data: garmentImageBase64 } }
            ];
        } 
        
        // MODE 2: CHEAP MOMENT GENERATION (Only 1 image input)
        else if (customBackground) {
            const userImageBase64 = req.files['userImage'][0].buffer.toString("base64");
            
            let textPrompt = `You are a luxury fashion photographer. 
            TASK: Change the background of Image 1.
            - Do not change the person, their face, or their clothing. 
            - Completely remove the old background.
            - Place them in a hyper-realistic setting matching this description: ${customBackground}.
            
            OUTPUT FORMAT:
            You must return a valid JSON object with EXACTLY one key:
            1. "image_base64": The base64 string of the generated moment image.`;

            prompt = [
                { text: textPrompt },
                { inlineData: { mimeType: req.files['userImage'][0].mimetype, data: userImageBase64 } }
            ];
        }

        // We force Gemini to return JSON so your server doesn't crash trying to read text
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash", // We use the standard model but force image base64 output in JSON
            contents: prompt,
            config: {
                responseMimeType: "application/json"
            }
        });

        // Parse the JSON response from Gemini
        const aiResult = JSON.parse(response.text());
        
        if (aiResult.image_base64) {
             res.json({ 
                 imageBase64: aiResult.image_base64,
                 recommendedSize: aiResult.recommended_size || null
             });
        } else {
             res.status(500).json({ error: "AI failed to generate visual data."});
        }
    } catch (error) {
        console.error("Error from AI:", error);
        res.status(500).json({ error: "Failed to process request." });
    }
});

app.listen(process.env.PORT || 3000, () => console.log('Sanditi Try-On Server is running!'));
