export const homeQueries = {
    auctions: {
        filters: {
            auction: {
                $eq: true,
            },
        },
        pagination: {
            pageSize: 6,
        },
    },
    topCollections: {
        pagination: {
            pageSize: 6,
        },
        sort: ['id:desc'],
    },
    explore: {
        pagination: {
            pageSize: 8,
        },
        sort: ['id:desc'],
    },
    recommendedCreators: {
        pagination: {
            pageSize: 6,
        },
        sort: ['id:desc'],
    },
};

export const exploreQueries = {
    auctions: {
        filters: {
            auction: {
                $eq: true,
            },
        },
        pagination: {
            pageSize: 12,
        },
        sort: ['id:desc'],
    },
};
