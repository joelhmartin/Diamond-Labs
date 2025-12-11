import React from 'react';
import { formatCurrency } from '~/utilities/product-helper';
import Link from 'next/link';
import Image from 'next/image';
import { getStrapiImageURL } from '~/services/strapiServices/image/getStrapiImageService';

export default function useProduct(product, productID) {
    const productPrice = product?.sale_price ? (
        <p className="ps-product__price sale">
            <span>$</span>
            {formatCurrency(product.sale_price)}
            <del className="ml-2">
                <span>$</span>
                {formatCurrency(product?.price)}
            </del>
        </p>
    ) : (
        <p className="ps-product__price">
            <span>$</span>
            {formatCurrency(product?.price)}
        </p>
    );

    const productThumbnailImage = product?.thumbnail ? (
        <Image
            src={getStrapiImageURL(product.thumbnail)}
            alt=""
            layout="responsive"
            width={200}
            height={200}
        />
    ) : (
        <img src="https://placehold.co/400x400" alt="" />
    );

    const productName = product ? (
        <Link
            href={'/product/[pid]'}
            as={`/product/${productID}`}
            className="ps-product__title">
            {product.title}
        </Link>
    ) : (
        <p>Untitled</p>
    );

    const getBadge = () => {
        let view;
        if (product.badge) {
            view = product.badge.map((badge) => {
                if (badge.type === 'sale') {
                    return (
                        <div className="ps-product__badge">{badge.value}</div>
                    );
                } else if (badge.type === 'outStock') {
                    return (
                        <div className="ps-product__badge out-stock">
                            {badge.value}
                        </div>
                    );
                } else {
                    return (
                        <div className="ps-product__badge hot">
                            {badge.value}
                        </div>
                    );
                }
            });
        }
        if (product.sale_price) {
            const discountPercent = (
                ((product.price - product.sale_price) / product.sale_price) *
                100
            ).toFixed(0);
            return <div className="ps-product__badge">-{discountPercent}%</div>;
        }
        return view;
    };

    const productBrand = (
        <Link href={'/shop'} className="text-capitalize">
            {product?.brands?.[0]?.name ?? 'No Brand'}
        </Link>
    );

    return {
        thumbnailImage: productThumbnailImage,
        price: productPrice,
        getHeadingPrice: productPrice,
        badge: () => getBadge(product),
        brand: productBrand,
        title: productName,
        productName,
    };
}
