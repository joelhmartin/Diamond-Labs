import { useState } from 'react';
import {
    getStrapiEntriesService,
    getStrapiEntryBySlugService,
} from '~/services/strapi/strapiQueryServices';

const COLLECTION_TYPE = 'posts';

export default function useBlog() {
    const [loading, setLoading] = useState(false);
    const [posts, setPosts] = useState([]);
    const [post, setPost] = useState(null);
    const [categories, setCategories] = useState([]);
    const [meta, setMeta] = useState(null);

    const enableLoading = () => {
        setLoading(true);
    };

    const disableLoading = () => {
        setLoading(false);
    };

    async function getPosts(queryRaw) {
        enableLoading();
        try {
            const response = await getStrapiEntriesService(
                COLLECTION_TYPE,
                queryRaw || { populate: '*' }
            );
            setPosts(response.data || []);
            setMeta(response.meta || null);
        } catch (error) {
            setPosts([]);
            setMeta(null);
        } finally {
            disableLoading();
        }
    }

    async function getCategories(queryRaw) {
        enableLoading();
        try {
            const response = await getStrapiEntriesService(
                'categories',
                queryRaw || { populate: '*' }
            );
            setCategories(response.data || []);
        } catch (error) {
            setCategories([]);
        } finally {
            disableLoading();
        }
    }

    async function getPost(slug) {
        enableLoading();
        await getStrapiEntryBySlugService(COLLECTION_TYPE, slug).then(
            async (response) => {
                await disableLoading();
                setPost(response ? response.attributes : null);
            }
        );
    }

    return {
        loading,
        posts,
        post,
        meta,
        categories,
        getCategories,
        getPosts,
    };
}
