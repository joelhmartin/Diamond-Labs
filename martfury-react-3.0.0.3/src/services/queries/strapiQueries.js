import qs from 'qs';
import { APP_DEFAULT_PAGE_SIZE } from '~/constants/appConstants';
import { DEFAULT_PAGE_SIZE } from '~/utilities/constants';

export const createStrapiQuery = (query, single = false) => {
    const initQuery = {
        populate: '*',
        pagination: { pageSize: APP_DEFAULT_PAGE_SIZE },
        ...query,
    };
    return single
        ? qs.stringify({ populate: '*' }, { encodeValuesOnly: true })
        : qs.stringify(initQuery, { encodeValuesOnly: true });
};

export const GET_CATEGORY_ENTRIES_QUERY = {
    populate: {
        products: {
            populate: {
                thumbnail: {
                    populate: '*',
                },
            },
        },
        images: {
            populate: '*',
        },
        product_categories: {
            populate: '*',
        },
    },
    pagination: {
        pageSize: DEFAULT_PAGE_SIZE,
    },
    sort: ['id:desc'],
};

export const GET_PRODUCT_BRAND_ENTRIES_QUERY = {
    populate: {
        products: {
            populate: {
                thumbnail: {
                    populate: '*',
                },
            },
        },
        images: {
            populate: '*',
        },
        product_categories: {
            populate: '*',
        },
    },
    pagination: {
        pageSize: DEFAULT_PAGE_SIZE,
    },
    sort: ['id:desc'],
};
