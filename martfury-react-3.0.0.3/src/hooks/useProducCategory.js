import { useEffect, useState } from 'react';

import { useBoolean } from 'ahooks';
import { GET_CATEGORY_ENTRIES_QUERY } from '~/services/queries/strapiQueries';
import { getStrapiEntriesService } from '~/services/strapi/strapiQueryServices';

const COLLECTION_TYPE = 'product-categories';
export default function useProducCategory(slug) {
    const [loading, { setTrue: enableLoading, setFalse: disableLoading }] =
        useBoolean();
    const [categoryDetails, setCategoryDetails] = useState(null);
    const [categories, setCategories] = useState([]);

    const getStrapiCategory = async () => {
        enableLoading();
        await getStrapiEntriesService(
            COLLECTION_TYPE,
            GET_CATEGORY_ENTRIES_QUERY
        ).then(async (response) => {
            await disableLoading();
            setCategoryDetails(
                response.length > 0 ? response[0].attributes : null
            );
        });
    };

    const getCategories = async () => {
        enableLoading();
        try {
            const response = await getStrapiEntriesService(
                COLLECTION_TYPE,
                GET_CATEGORY_ENTRIES_QUERY
            );
            setCategories(response.data || []);
        } catch (e) {
            setCategories([]);
            setCategoryDetails(null);
        } finally {
            disableLoading();
        }
    };

    useEffect(() => {
        getStrapiCategory();
    }, [slug]);

    return {
        loading,
        categoryDetails,
        categories,
        getStrapiCategory,
        getCategories,
    };
}
