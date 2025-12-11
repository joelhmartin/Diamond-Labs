import { useCallback, useEffect, useState } from 'react';

import { useBoolean } from 'ahooks';
import { DEFAULT_PAGE_SIZE } from '~/utilities/constants';
import { getStrapiEntriesService } from '~/services/strapi/strapiQueryServices';

const COLLECTION_TYPE = 'product-collections';

export default function useGetProducCollection(collectionSlug) {
    const [
        collectionLoading,
        { setTrue: enableLoading, setFalse: disableLoading },
    ] = useBoolean();

    const [collectionDetail, setCollectionDetails] = useState(null);

    const getStrapiCollection = useCallback(async () => {
        enableLoading();
        const query = {
            filters: {
                slug: {
                    $eq: collectionSlug,
                },
            },
            pagination: {
                pageSize: DEFAULT_PAGE_SIZE,
            },
            sort: ['id:desc'],
            populate: {
                products: {
                    populate: {
                        thumbnail: {
                            populate: '*',
                        },
                        images: {
                            populate: '*',
                        },
                    },
                },
            },
        };
        try {
            const response = await getStrapiEntriesService(
                COLLECTION_TYPE,
                query
            );
            setCollectionDetails(
                response && response.data.length > 0 ? response.data[0] : null
            );
        } catch (err) {
            setCollectionDetails(null);
        } finally {
            disableLoading();
        }
    }, [collectionSlug, enableLoading, disableLoading]);

    useEffect(() => {
        getStrapiCollection();
    }, [collectionSlug]);

    return {
        collectionLoading,
        collectionDetail,
        getStrapiCollection,
    };
}
