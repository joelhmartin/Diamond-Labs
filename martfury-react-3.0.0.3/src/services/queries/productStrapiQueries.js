import { DEFAULT_PAGE_SIZE } from '~/utilities/constants';

export const DEFAULT_QUERY_GET_PRODUCTS = {
    pagination: {
        pageSize: DEFAULT_PAGE_SIZE,
    },
    sort: ['id:desc'],
};

export const DEFAULT_QUERY_GET_PRODUCT = {
    populate: '*',
};
