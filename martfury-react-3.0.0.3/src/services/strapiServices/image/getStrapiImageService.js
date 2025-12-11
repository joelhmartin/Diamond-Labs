const imageBaseURL = process.env.NEXT_PUBLIC_API_PATH;

export const getStrapiImageURL = (source, format, inArray = false) => {
    const attributes = inArray ? source?.attributes : source?.data?.attributes;
    const imageUrl = attributes?.formats?.[format]?.url || attributes?.url;

    return imageUrl
        ? `${imageBaseURL}${imageUrl}`
        : '/static/img/products/martfury-product-placeholder.svg';
};
