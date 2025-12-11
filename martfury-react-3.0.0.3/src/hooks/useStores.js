import { useState } from 'react';
import {
    getStrapiEntriesService,
    getStrapiEntryBySlugService,
} from '~/services/strapi/strapiQueryServices';

export default function useStores() {
    const [loading, setLoading] = useState(false);
    const [stores, setStores] = useState(null);
    const [store, setStore] = useState(null);
    const [meta, setMeta] = useState(null);

    const enableLoading = () => {
        setLoading(true);
    };

    const disableLoading = () => {
        setLoading(false);
    };

    return {
        loading,
        stores,
        store,
        meta,
        getStores: async (payload) => {
            enableLoading();
            try {
                const response = await getStrapiEntriesService(
                    'product-stores',
                    payload
                );
                setStores(response.data || []);
                setMeta(response.meta || null);
            } catch (error) {
                setStores([]);
                setMeta(null);
            } finally {
                disableLoading();
            }
        },

        getStore: async (payload) => {
            enableLoading();
            await getStrapiEntryBySlugService('product-stores', payload).then(
                async (response) => {
                    await disableLoading();
                    setStore(response ? response.attributes : null);
                }
            );
        },
    };
}
