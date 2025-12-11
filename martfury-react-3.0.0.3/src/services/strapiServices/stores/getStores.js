import { strapiGetEntries } from '~/services/strapiServices/strapiHttpServices';
import { createStrapiQuery } from '~/services/queries/strapiQueries';
import { getStrapiEntryBySlugService } from '~/services/strapi/strapiQueryServices';

export const getStrapiStoresService = async (queryRaw) => {
    try {
        const response = await strapiGetEntries(
            'product-stores',
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

export const getStrapiStoreBySlugService = async (slug) => {
    try {
        const response = await getStrapiEntryBySlugService(
            'product-stores',
            slug
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
