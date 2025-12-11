import axios from 'axios';

export const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

export const customHeaders = {
    Accept: "application/json",
};

export default axios.create({
    baseUrl,
    headers: customHeaders,
});

