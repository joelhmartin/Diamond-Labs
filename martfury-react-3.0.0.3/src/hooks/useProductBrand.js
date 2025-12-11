import { useEffect, useState } from 'react';
import { useBoolean } from 'ahooks';
import {
    GET_CATEGORY_ENTRIES_QUERY,
    GET_PRODUCT_BRAND_ENTRIES_QUERY,
} from '~/services/queries/strapiQueries';
import {
    getStrapiEntriesService,
    getStrapiEntryBySlugService,
} from '~/services/strapi/strapiQueryServices';

const COLLECTION_TYPE = 'product-brands';

export default function useProductBrand(slug) {
    const [loading, { setTrue: enableLoading, setFalse: disableLoading }] =
        useBoolean();
    const [brands, setBrands] = useState([]);
    const [brandDetails, setBrandDetails] = useState(null);

    const getStrapiBrand = async () => {
        enableLoading();
        await getStrapiEntryBySlugService(
            COLLECTION_TYPE,
            slug,
            GET_CATEGORY_ENTRIES_QUERY
        ).then(async (response) => {
            await disableLoading();
            setBrandDetails(
                response.length > 0 ? response[0].attributes : null
            );
        });
    };

    const getBrands = async () => {
        enableLoading();
        try {
            const response = await getStrapiEntriesService(
                COLLECTION_TYPE,
                GET_PRODUCT_BRAND_ENTRIES_QUERY
            );
            setBrands(response.data || []);
        } catch (e) {
            setBrands(null);
        } finally {
            disableLoading();
        }
    };
    useEffect(() => {
        getStrapiBrand();
    }, [slug]);

    return {
        loading,
        brands,
        brandDetails,
        getBrands,
    };
}
