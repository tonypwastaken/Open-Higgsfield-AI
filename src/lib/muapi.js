import { getModelById, getVideoModelById, getI2IModelById, getI2VModelById } from './models.js';

export class MuapiClient {
    constructor() {
        // Ideally user provides this in settings
        this.baseUrl = import.meta.env.DEV ? '' : 'https://api.muapi.ai';
    }

    getKey() {
        const key = localStorage.getItem('muapi_key') || import.meta.env.MUAPI_KEY;
        if (!key) throw new Error('API Key missing. Set MUAPI_KEY in .env or add it in Settings.');
        return key;
    }

    getFalKey() {
        const key = localStorage.getItem('fal_key') || import.meta.env.FAL_AI_API_KEY;
        if (!key) throw new Error('fal.ai API Key missing. Set FAL_AI_API_KEY in .env or add it in Settings.');
        return key;
    }

    /**
     * Maps a generic aspect_ratio string to a fal.ai image_size enum value.
     */
    mapAspectRatioToFalImageSize(ar) {
        const map = {
            '1:1':  'square_hd',
            '16:9': 'landscape_16_9',
            '9:16': 'portrait_16_9',
            '4:3':  'landscape_4_3',
            '3:4':  'portrait_4_3',
            '2:3':  'portrait_4_3',
            '3:2':  'landscape_4_3',
            '21:9': 'landscape_16_9',
        };
        return map[ar] || 'square_hd';
    }

    /**
     * Generates an image via fal.ai using the queue/poll pattern.
     */
    async generateImageFal(params, modelInfo) {
        const key = this.getFalKey();
        const falEndpoint = modelInfo.falEndpoint;
        const falBase = import.meta.env.DEV ? '/fal' : 'https://queue.fal.run';
        const submitUrl = `${falBase}/${falEndpoint}`;

        const payload = { prompt: params.prompt };
        if (params.aspect_ratio) {
            payload.image_size = this.mapAspectRatioToFalImageSize(params.aspect_ratio);
        }
        if (params.seed && params.seed !== -1) {
            payload.seed = params.seed;
        }

        console.log('[Fal] Requesting:', submitUrl);
        console.log('[Fal] Payload:', payload);

        const submitRes = await fetch(submitUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Key ${key}`
            },
            body: JSON.stringify(payload)
        });

        if (!submitRes.ok) {
            const errText = await submitRes.text();
            console.error('[Fal] Submit Error:', errText);
            throw new Error(`fal.ai Request Failed: ${submitRes.status} ${submitRes.statusText} - ${errText.slice(0, 200)}`);
        }

        const submitData = await submitRes.json();
        console.log('[Fal] Submit Response:', submitData);

        const requestId = submitData.request_id;
        if (!requestId) {
            // Direct result (no queue)
            const imageUrl = submitData.images?.[0]?.url;
            return { ...submitData, url: imageUrl };
        }

        // Poll status — use the URLs returned by fal.ai in the submit response
        console.log('[Fal] Polling for result, request_id:', requestId);
        const statusUrl = submitData.status_url || `${falBase}/${falEndpoint}/requests/${requestId}/status`;
        const resultUrl = submitData.response_url || `${falBase}/${falEndpoint}/requests/${requestId}`;

        for (let attempt = 1; attempt <= 90; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            console.log(`[Fal] Polling attempt ${attempt}/90...`);

            const statusRes = await fetch(statusUrl, {
                headers: { 'Authorization': `Key ${key}` }
            });

            if (!statusRes.ok) {
                console.warn(`[Fal] Status poll error (${statusRes.status})`);
                if (statusRes.status >= 500) continue;
                const errText = await statusRes.text();
                throw new Error(`fal.ai Poll Failed: ${statusRes.status} - ${errText.slice(0, 100)}`);
            }

            const statusData = await statusRes.json();
            console.log('[Fal] Status:', statusData.status);

            if (statusData.status === 'COMPLETED') {
                const resultRes = await fetch(resultUrl, {
                    headers: { 'Authorization': `Key ${key}` }
                });
                if (!resultRes.ok) {
                    const errText = await resultRes.text();
                    throw new Error(`fal.ai Result Fetch Failed: ${resultRes.status} - ${errText.slice(0, 100)}`);
                }
                const result = await resultRes.json();
                console.log('[Fal] Result:', result);
                const imageUrl = result.images?.[0]?.url;
                console.log('[Fal] Image URL:', imageUrl);
                return { ...result, url: imageUrl };
            }

            if (statusData.status === 'FAILED') {
                throw new Error(`fal.ai generation failed: ${statusData.error || 'Unknown error'}`);
            }
        }

        throw new Error('fal.ai generation timed out after polling.');
    }

    /**
     * Generates an image (Text-to-Image or Image-to-Image)
     * @param {Object} params
     * @param {string} params.model
     * @param {string} params.prompt
     * @param {string} params.negative_prompt
     * @param {string} params.aspect_ratio
     * @param {number} params.steps
     * @param {number} params.guidance_scale
     * @param {number} params.seed
     * @param {string} [params.image_url] - If present, treats as Image-to-Image
     */
    async generateImage(params) {
        // Resolve model info first so we can route to fal if needed
        const modelInfo = getModelById(params.model);

        if (modelInfo?.provider === 'fal') {
            return this.generateImageFal(params, modelInfo);
        }

        const key = this.getKey();

        // Resolve endpoint from model definition
        const endpoint = modelInfo?.endpoint || params.model;
        const url = `${this.baseUrl}/api/v1/${endpoint}`;

        // Build payload matching the API's expected format
        const finalPayload = {
            prompt: params.prompt,
        };

        // Aspect ratio (send as string, the API handles it)
        if (params.aspect_ratio) {
            finalPayload.aspect_ratio = params.aspect_ratio;
        }

        // Resolution
        if (params.resolution) {
            finalPayload.resolution = params.resolution;
        }

        // Quality (used by seedream and similar models)
        if (params.quality) {
            finalPayload.quality = params.quality;
        }

        // Image-to-Image
        if (params.image_url) {
            finalPayload.image_url = params.image_url;
            finalPayload.strength = params.strength || 0.6;
        } else {
            finalPayload.image_url = null;
        }

        // Optional params if supported by model
        if (params.seed && params.seed !== -1) {
            finalPayload.seed = params.seed;
        }

        console.log('[Muapi] Requesting:', url);
        console.log('[Muapi] Payload:', finalPayload);

        try {
            // Step 1: Submit the task
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': key
                },
                body: JSON.stringify(finalPayload)
            });

            if (!response.ok) {
                const errText = await response.text();
                console.error('[Muapi] API Error Body:', errText);
                throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${errText.slice(0, 100)}`);
            }

            const submitData = await response.json();
            console.log('[Muapi] Submit Response:', submitData);

            // Extract request_id for polling
            const requestId = submitData.request_id || submitData.id;
            if (!requestId) {
                // Some endpoints return the result directly
                return submitData;
            }

            // Step 2: Poll for results
            console.log('[Muapi] Polling for results, request_id:', requestId);
            const result = await this.pollForResult(requestId, key);

            // Normalize: extract image URL from outputs array
            const imageUrl = result.outputs?.[0] || result.url || result.output?.url;
            console.log('[Muapi] Image URL:', imageUrl);
            return { ...result, url: imageUrl };

        } catch (error) {
            console.error("Muapi Client Error:", error);
            throw error;
        }
    }

    /**
     * Polls the predictions endpoint until the result is ready.
     * @param {string} requestId - The request ID from the submit response
     * @param {string} key - The API key
     * @param {number} maxAttempts - Maximum polling attempts (default 60 = ~2 min)
     * @param {number} interval - Polling interval in ms (default 2000)
     */
    async pollForResult(requestId, key, maxAttempts = 60, interval = 2000) {
        const pollUrl = `${this.baseUrl}/api/v1/predictions/${requestId}/result`;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, interval));

            console.log(`[Muapi] Polling attempt ${attempt}/${maxAttempts}...`);

            try {
                const response = await fetch(pollUrl, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': key
                    }
                });

                if (!response.ok) {
                    const errText = await response.text();
                    console.warn(`[Muapi] Poll error (${response.status}):`, errText);
                    // Continue polling on non-fatal errors
                    if (response.status >= 500) continue;
                    throw new Error(`Poll Failed: ${response.status} - ${errText.slice(0, 100)}`);
                }

                const data = await response.json();
                console.log('[Muapi] Poll Response:', data);

                const status = data.status?.toLowerCase();

                if (status === 'completed' || status === 'succeeded' || status === 'success') {
                    return data;
                }

                if (status === 'failed' || status === 'error') {
                    throw new Error(`Generation failed: ${data.error || 'Unknown error'}`);
                }

                // Otherwise (processing, pending, etc.) keep polling
            } catch (error) {
                if (attempt === maxAttempts) throw error;
                console.warn('[Muapi] Poll attempt failed, retrying...', error.message);
            }
        }

        throw new Error('Generation timed out after polling.');
    }

    async generateVideo(params) {
        const key = this.getKey();

        const modelInfo = getVideoModelById(params.model);
        const endpoint = modelInfo?.endpoint || params.model;
        const url = `${this.baseUrl}/api/v1/${endpoint}`;

        const finalPayload = { prompt: params.prompt };

        if (params.aspect_ratio) finalPayload.aspect_ratio = params.aspect_ratio;
        if (params.duration) finalPayload.duration = params.duration;
        if (params.resolution) finalPayload.resolution = params.resolution;
        if (params.quality) finalPayload.quality = params.quality;
        if (params.image_url) finalPayload.image_url = params.image_url;

        console.log('[Muapi] Video Request:', url);
        console.log('[Muapi] Video Payload:', finalPayload);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': key
                },
                body: JSON.stringify(finalPayload)
            });

            if (!response.ok) {
                const errText = await response.text();
                console.error('[Muapi] API Error Body:', errText);
                throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${errText.slice(0, 100)}`);
            }

            const submitData = await response.json();
            console.log('[Muapi] Video Submit Response:', submitData);

            const requestId = submitData.request_id || submitData.id;
            if (!requestId) return submitData;

            console.log('[Muapi] Polling for video results, request_id:', requestId);
            const result = await this.pollForResult(requestId, key, 120, 2000);

            const videoUrl = result.outputs?.[0] || result.url || result.output?.url;
            console.log('[Muapi] Video URL:', videoUrl);
            return { ...result, url: videoUrl };

        } catch (error) {
            console.error("Muapi Video Client Error:", error);
            throw error;
        }
    }

    /**
     * Generates an image using an Image-to-Image model.
     * The model's imageField determines which payload key receives the uploaded image URL.
     * @param {Object} params
     * @param {string} params.model - i2iModel id
     * @param {string} params.image_url - The uploaded reference image URL
     * @param {string} [params.prompt] - Optional text prompt
     * @param {string} [params.aspect_ratio]
     * @param {string} [params.resolution]
     */
    async generateI2I(params) {
        const key = this.getKey();
        const modelInfo = getI2IModelById(params.model);
        const endpoint = modelInfo?.endpoint || params.model;
        const url = `${this.baseUrl}/api/v1/${endpoint}`;

        const finalPayload = {};

        // Only include prompt if the model supports it and one was provided
        if (params.prompt) finalPayload.prompt = params.prompt;

        // Place the uploaded image(s) in the correct field for this model
        const imageField = modelInfo?.imageField || 'image_url';
        const imagesList = params.images_list?.length > 0 ? params.images_list : (params.image_url ? [params.image_url] : null);
        if (imagesList) {
            if (imageField === 'images_list') {
                finalPayload.images_list = imagesList;
            } else {
                finalPayload[imageField] = imagesList[0];
            }
        }

        if (params.aspect_ratio) finalPayload.aspect_ratio = params.aspect_ratio;
        if (params.resolution) finalPayload.resolution = params.resolution;
        if (params.quality) finalPayload.quality = params.quality;

        console.log('[Muapi] I2I Request:', url);
        console.log('[Muapi] I2I Payload:', finalPayload);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': key },
                body: JSON.stringify(finalPayload)
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${errText.slice(0, 100)}`);
            }

            const submitData = await response.json();
            console.log('[Muapi] I2I Submit Response:', submitData);

            const requestId = submitData.request_id || submitData.id;
            if (!requestId) return submitData;

            const result = await this.pollForResult(requestId, key);
            const imageUrl = result.outputs?.[0] || result.url || result.output?.url;
            console.log('[Muapi] I2I Result URL:', imageUrl);
            return { ...result, url: imageUrl };
        } catch (error) {
            console.error('Muapi I2I Error:', error);
            throw error;
        }
    }

    /**
     * Generates a video using an Image-to-Video model.
     * @param {Object} params
     * @param {string} params.model - i2vModel id
     * @param {string} params.image_url - The uploaded start frame image URL
     * @param {string} [params.prompt]
     * @param {string} [params.aspect_ratio]
     * @param {string} [params.resolution]
     * @param {number} [params.duration]
     * @param {string} [params.quality]
     */
    async generateI2V(params) {
        const key = this.getKey();
        const modelInfo = getI2VModelById(params.model);
        const endpoint = modelInfo?.endpoint || params.model;
        const url = `${this.baseUrl}/api/v1/${endpoint}`;

        const finalPayload = {};

        if (params.prompt) finalPayload.prompt = params.prompt;

        // Place image in the correct field for this model
        const imageField = modelInfo?.imageField || 'image_url';
        if (params.image_url) {
            if (imageField === 'images_list') {
                finalPayload.images_list = [params.image_url];
            } else {
                finalPayload[imageField] = params.image_url;
            }
        }

        if (params.aspect_ratio) finalPayload.aspect_ratio = params.aspect_ratio;
        if (params.duration) finalPayload.duration = params.duration;
        if (params.resolution) finalPayload.resolution = params.resolution;
        if (params.quality) finalPayload.quality = params.quality;

        console.log('[Muapi] I2V Request:', url);
        console.log('[Muapi] I2V Payload:', finalPayload);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': key },
                body: JSON.stringify(finalPayload)
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`API Request Failed: ${response.status} ${response.statusText} - ${errText.slice(0, 100)}`);
            }

            const submitData = await response.json();
            console.log('[Muapi] I2V Submit Response:', submitData);

            const requestId = submitData.request_id || submitData.id;
            if (!requestId) return submitData;

            const result = await this.pollForResult(requestId, key, 120, 2000);
            const videoUrl = result.outputs?.[0] || result.url || result.output?.url;
            console.log('[Muapi] I2V Result URL:', videoUrl);
            return { ...result, url: videoUrl };
        } catch (error) {
            console.error('Muapi I2V Error:', error);
            throw error;
        }
    }

    /**
     * Uploads a file to muapi and returns the hosted URL.
     * @param {File} file - The image file to upload
     * @returns {Promise<string>} The hosted URL of the uploaded file
     */
    async uploadFile(file) {
        const key = this.getKey();
        const url = `${this.baseUrl}/api/v1/upload_file`;

        const formData = new FormData();
        formData.append('file', file);

        console.log('[Muapi] Uploading file:', file.name);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'x-api-key': key },
            body: formData
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`File upload failed: ${response.status} - ${errText.slice(0, 100)}`);
        }

        const data = await response.json();
        console.log('[Muapi] Upload response:', data);

        const fileUrl = data.url || data.file_url || data.data?.url;
        if (!fileUrl) throw new Error('No URL returned from file upload');
        return fileUrl;
    }

    getDimensionsFromAR(ar) {
        // Base unit 1024 (Flux standard)
        switch (ar) {
            case '1:1': return [1024, 1024];
            case '16:9': return [1280, 720]; // 1024*1024 area approx
            case '9:16': return [720, 1280];
            case '4:3': return [1152, 864];
            case '3:2': return [1216, 832];
            case '21:9': return [1536, 640];
            default: return [1024, 1024];
        }
    }
}

export const muapi = new MuapiClient();
