import {
    strapiGetEntries,
    strapiGetEntryById,
} from '~/services/strapiServices/strapiHttpServices';
import { createStrapiQuery } from '~/services/queries/strapiQueries';

export const getStrapiEntriesService = async (collectionType, queryRaw) => {
    try {
        const response = await strapiGetEntries(
            collectionType,
            createStrapiQuery(queryRaw)
        );
        if (response && response.data) {
            return response.data;
        } else {
            return { data: [], meta: null };
        }
    } catch (e) {
        console.log({ Error: e.message });
        return { data: [], meta: null };
    }
};

export const getStrapiEntryByIdService = async (collectionType, id, query) => {
    try {
        const response = await strapiGetEntryById(
            collectionType,
            id,
            createStrapiQuery(query, true)
        );
        return response?.data?.data ?? null;
    } catch (e) {
        return null;
    }
};

export const getStrapiEntryBySlugService = async (
    collectionType,
    slug,
    otherQuery
) => {
    try {
        const response = await strapiGetEntries(
            collectionType,
            createStrapiQuery(
                {
                    ...otherQuery,
                    filters: {
                        slug: {
                            $eq: slug,
                        },
                    },
                },
                false
            )
        );
        if (response && response.data) {
            return response.data.data.length > 0 ? response.data.data[0] : null;
        } else {
            return null;
        }
    } catch (e) {
        return null;
    }
};
