import httpService from '~/services/httpService';

const baseStrapiUrl = process.env.NEXT_PUBLIC_BASE_URL;

export const strapiGetEntries = (collectionType, query = '') => {
    const path = `${baseStrapiUrl}/${collectionType}`;
    return httpService.get(query ? `${path}?${query}` : path);
};

export const strapiGetEntryById = (collectionType, entryId, query) => {
    const path = `${baseStrapiUrl}/${collectionType}/${entryId}`;
    return httpService.get(query ? `${path}?${query}` : path);
};

/*
export const getEntryById = (collectionType, entryId, queries) => {
    const path = `${process.env.NEXT_PUBLIC_BASE_URL}/${collectionType}/${entryId}`;
    const endPoint = queries ? `${path}?${serializeQuery(queries)}` : path;
    return httpService.get(endPoint);
};*/

export const createEntry = (collectionType, payload) => {
    return httpService.post(
        `${process.env.NEXT_PUBLIC_BASE_URL}/${collectionType}`,
        payload
    );
};
export const updateEntry = (collectionType, payload) => {
    return httpService.put(
        `${process.env.NEXT_PUBLIC_BASE_URL}/${collectionType}`,
        payload
    );
};
