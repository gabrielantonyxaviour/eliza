export enum ImageGenModel {
    TogetherAI = "TogetherAI",
    Dalle = "Dalle",
    Heurist = "Heurist",
}

const imageGenModels = {
    [ImageGenModel.TogetherAI]: {
        steps: 4,
        subModel: "black-forest-labs/FLUX.1-schnell",
    },
    [ImageGenModel.Dalle]: {
        steps: 0,
        subModel: "dall-e-3",
    },
    [ImageGenModel.Heurist]: {
        steps: 0,
        subModel: "FLUX.1-dev",
    },
};

export function getModel(model: ImageGenModel) {
    return imageGenModels[model];
}
