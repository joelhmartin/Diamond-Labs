import React from 'react';
import Link from 'next/link';
import ProductActions from '~/components/elements/products/modules/ProductActions';
import Rating from '~/components/elements/Rating';
import useProduct from '~/hooks/useProduct';

const SimpleProduct = ({ product }) => {
    const { thumbnailImage, price, title, badge } = useProduct(
        product.attributes
    );

    return (
        <div className="ps-product ps-product--simple">
            <div className="ps-product__thumbnail">
                <Link href={'/product/[pid]'} as={`/product/${product.id}`}>
                    {thumbnailImage}
                </Link>
                {badge(product)}
                <ProductActions product={product} />
            </div>
            <div className="ps-product__container">
                <div className="ps-product__content">
                    {title}
                    <div className="ps-product__rating">
                        <Rating />
                        <span>{product.ratingCount || 0}</span>
                    </div>
                    {price}
                </div>
            </div>
        </div>
    );
};

export default SimpleProduct;
