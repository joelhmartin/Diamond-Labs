import React from 'react';
import Link from 'next/link';
import Rating from '~/components/elements/Rating';
import useProduct from '~/hooks/useProduct';

const HorizontalProduct = ({ product }) => {
    const { thumbnailImage, price, title } = useProduct(
        product.attributes,
        product.id
    );

    return (
        <div className="ps-product--horizontal">
            <div className="ps-product__thumbnail">
                <Link href={'/product/[pid]'} as={`/product/${product.id}`}>
                    {thumbnailImage}
                </Link>
            </div>
            <div className="ps-product__content">
                {title}
                <div className="ps-product__rating">
                    <Rating />
                </div>
                {price}
            </div>
        </div>
    );
};

export default HorizontalProduct;
