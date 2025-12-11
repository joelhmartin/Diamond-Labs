import React, { useMemo } from 'react';
import Link from 'next/link';
import Rating from '../Rating';
import { formatCurrency } from '~/utilities/product-helper';
import ProductActions from '~/components/elements/products/modules/ProductActions';
import ProductProgressbar from '~/components/elements/products/modules/ProductProgressbar';
import useProduct from '~/hooks/useProduct';

const DealOfDayProduct = ({ product }) => {
    const { thumbnailImage, badge, title } = useProduct(
        product.attributes,
        product.id
    );
    const { price, sale_price, is_sale } = product.attributes;

    const extendedPrice = useMemo(() => {
        if (is_sale) {
            return (
                <p className="ps-product__price sale">
                    ${formatCurrency(price)}
                    <del className="ml-2">${formatCurrency(sale_price)}</del>
                    <small>18% off</small>
                </p>
            );
        } else {
            return (
                <p className="ps-product__price">${formatCurrency(price)}</p>
            );
        }
    }, [price, sale_price, is_sale]);

    return (
        <div className="ps-product ps-product--inner">
            <div className="ps-product__thumbnail">
                <Link href={'/product/[pid]'} as={`/product/${product.id}`}>
                    {thumbnailImage}
                </Link>
                {badge(product)}
                <ProductActions product={product} />
            </div>
            <div className="ps-product__container">
                <Link href={'/shop'} className="ps-product__vendor">
                    Young Shop
                </Link>
                <div className="ps-product__content">
                    {extendedPrice}
                    {title}
                    <div className="ps-product__rating">
                        <Rating />
                        <span>{product.ratingCount}</span>
                    </div>
                    <ProductProgressbar product={product} />
                </div>
            </div>
        </div>
    );
};

export default DealOfDayProduct;
