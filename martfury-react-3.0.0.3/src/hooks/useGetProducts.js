import { useState } from 'react';
import { DEFAULT_QUERY_GET_PRODUCT } from '~/services/queries/productStrapiQueries';
import {
    getStrapiEntriesService,
    getStrapiEntryByIdService,
} from '~/services/strapi/strapiQueryServices';

const COLLECTION_TYPE = 'products';

export default function useGetProducts() {
    const [loading, setLoading] = useState(false);
    const [product, setProduct] = useState(null);
    const [products, setProducts] = useState([]);
    const [meta, setMeta] = useState(null);
    const toggleLoading = (state) => setLoading(state);

    const getStrapiProducts = async (queryRaw) => {
        toggleLoading(true);
        try {
            const response = await getStrapiEntriesService(
                COLLECTION_TYPE,
                queryRaw
            );
            setProducts(response.data || []);
            setMeta(response.meta || null);
        } catch (error) {
            console.error('Error fetching products:', error);
            setProducts([]);
            setMeta(null);
        } finally {
            toggleLoading(false);
        }
    };

    const getStrapiProduct = async (payload) => {
        toggleLoading(true);
        try {
            const response = await getStrapiEntryByIdService(
                'products',
                payload,
                DEFAULT_QUERY_GET_PRODUCT
            );
            setProduct(response);
        } catch (error) {
            console.error('Error fetching product:', error);
            setProduct(null);
        } finally {
            toggleLoading(false);
        }
    };

    return {
        loading,
        product,
        products,
        meta,
        getStrapiProducts,
        getStrapiProduct,
    };
}
