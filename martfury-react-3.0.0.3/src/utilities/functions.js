import { product_page_size } from '~/platform/configuration';
import qs from 'qs';

export const generateQuery = (query, single = false) => {
    const initQuery = {
        populate: '*',
        pagination: {
            pageSize: product_page_size,
        },
    };
    if (query !== null || true) {
        if (single) {
            return qs.stringify(
                {
                    ...query,
                },
                {
                    encodeValuesOnly: true,
                }
            );
        } else {
            return qs.stringify(
                {
                    ...initQuery,
                    ...query,
                },
                {
                    encodeValuesOnly: true,
                }
            );
        }
    } else {
        return qs.stringify(
            {
                ...initQuery,
            },
            {
                encodeValuesOnly: true,
            }
        );
    }
};

export const getEntryFromList = (arr) => {
    return arr?.length > 0 ? arr[0] : null;
};
