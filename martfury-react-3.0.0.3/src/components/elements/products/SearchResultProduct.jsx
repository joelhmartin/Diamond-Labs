import React from 'react';
import Link from 'next/link';
import Rating from '~/components/elements/Rating';
import useProduct from '~/hooks/useProduct';

const SearchResultProduct = ({ product }) => {
    const { thumbnailImage, price, title } = useProduct(
        product.attributes,
        product.id
    );

    return (
        <div className="ps-product ps-product--wide ps-product--search-result">
            <div className="ps-product__thumbnail">
                <Link href={'/product/[pid]'} as={`/product/${product.id}`}>
                    {thumbnailImage}
                </Link>
            </div>
            <div className="ps-product__content">
                {title}
                <div className="ps-product__rating">
                    <Rating />
                    <span>{product.ratingCount || 0}</span>
                </div>
                {price}
            </div>
        </div>
    );
};
export default SearchResultProduct;
