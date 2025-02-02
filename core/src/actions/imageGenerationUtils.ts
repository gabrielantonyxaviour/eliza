// TODO: Replace with the vercel ai sdk and support all providers
import { Buffer } from "buffer";
import Together from "together-ai";
import { IAgentRuntime } from "../core/types.ts";
import { getModel, ImageGenModel } from "../core/imageGenModels.ts";
import OpenAI from "openai";
import { SupabaseClient } from "@supabase/supabase-js";
import Heurist from 'heurist'
export const generateImage = async (
    data: {
        prompt: string;
        width: number;
        height: number;
        count?: number;
    },
    runtime: IAgentRuntime
): Promise<{
    success: boolean;
    data?: string[];
    error?: any;
}> => {
    const { prompt, width, height } = data;
    let { count } = data;
    if (!count) {
        count = 1;
    }

    const imageGenModel = runtime.imageGenModel;
    const model = getModel(imageGenModel);
    const apiKey =
        imageGenModel === ImageGenModel.TogetherAI
            ? runtime.getSetting("TOGETHER_API_KEY")

            : imageGenModel === ImageGenModel.Heurist ? runtime.getSetting("HEURIST_API_KEY") : runtime.getSetting("OPENAI_API_KEY");

    try {
        if (imageGenModel === ImageGenModel.TogetherAI) {
            const together = new Together({ apiKey });
            const response = await together.images.create({
                model: "black-forest-labs/FLUX.1-schnell",
                prompt,
                width,
                height,
                steps: model.steps,
                n: count,
            });
            const urls: string[] = [];
            for (let i = 0; i < response.data.length; i++) {
                //@ts-ignore
                const url = response.data[i].url;
                urls.push(url);
            }
            const base64s = await Promise.all(
                urls.map(async (url) => {
                    const response = await fetch(url);
                    const blob = await response.blob();
                    const buffer = await blob.arrayBuffer();
                    let base64 = Buffer.from(buffer).toString("base64");
                    base64 = "data:image/jpeg;base64," + base64;
                    return base64;
                })
            );
            return { success: true, data: base64s };
        } else if (imageGenModel === ImageGenModel.Heurist) {
            const heurist = new Heurist({
                apiKey: apiKey
            })
            const response = await heurist.images.generate({
                model: model.subModel,
                prompt,
                width,
                height,
                num_iterations: model.steps,
            });
            const imageResponse = await fetch(response.url)
            const imageBuffer = await imageResponse.arrayBuffer();

            const base64String = Buffer.from(imageBuffer).toString('base64');

            // Ensure correct Base64 format with data prefix
            const base64WithPrefix = `data:image/png;base64,${base64String}`;

            // Return the success object with the Base64 string
            return { success: true, data: [base64WithPrefix] };


        } else {
            let targetSize = `${width}x${height}`;
            if (
                targetSize !== "1024x1024" &&
                targetSize !== "1792x1024" &&
                targetSize !== "1024x1792"
            ) {
                targetSize = "1024x1024";
            }
            const openai = new OpenAI({ apiKey });
            const response = await openai.images.generate({
                model: model.subModel,
                prompt,
                size: targetSize as "1024x1024" | "1792x1024" | "1024x1792",
                n: count,
                response_format: "b64_json",
            });

            const base64s = response.data.map(
                (image) => `data:image/png;base64,${image.b64_json}`
            );
            return { success: true, data: base64s };
        }
    } catch (error) {
        console.error(error);
        return { success: false, error: error };
    }
};

export const generateCaption = async (
    data: { imageUrl: string },
    runtime: IAgentRuntime
): Promise<{
    title: string;
    description: string;
}> => {
    const { imageUrl } = data;
    const resp = await runtime.imageDescriptionService.describeImage(imageUrl);
    return {
        title: resp.title.trim(),
        description: resp.description.trim(),
    };
};

export async function storeImage(base64Image: string, supabase: SupabaseClient): Promise<{ url: string, buffer: Buffer }> {
    // Remove data URL prefix if present
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');

    // Convert base64 to Buffer
    const buffer = Buffer.from(base64Data, 'base64');

    // Generate unique filename
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.png`;

    // Upload to Supabase Storage
    const { data, error } = await supabase
        .storage
        .from('image_gen')
        .upload(`tweets/${fileName}`, buffer, {
            contentType: 'image/png'
        });

    if (error) throw error;

    // Get public URL
    const { data: { publicUrl } } = supabase
        .storage
        .from('image_gen')
        .getPublicUrl(`tweets/${fileName}`);


    return { url: publicUrl, buffer: buffer };
}