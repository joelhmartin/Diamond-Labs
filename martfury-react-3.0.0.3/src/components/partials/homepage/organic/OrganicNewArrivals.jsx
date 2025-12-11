import React, { useMemo } from 'react';
import Link from 'next/link';
import Product from '~/components/elements/products/Product';
import useGetProducCollection from '~/hooks/useGetProducCollection';
import { generateTempArray } from '~/utilities/common-helpers';
import SkeletonProduct from '~/components/elements/skeletons/SkeletonProduct';

const links = [
    {
        value: '/shop',
        text: 'Milks & Creams',
    },
    {
        value: '/shop',
        text: 'Fruits',
    },
    {
        value: '/shop',
        text: 'Vegetables',
    },
    {
        value: '/shop',
        text: 'Ocean Foods',
    },
    {
        value: '/shop',
        text: 'Fresh Meats',
    },
    {
        value: '/shop',
        text: 'View All',
    },
];

const OrganicNewArrivals = ({ collectionSlug }) => {
    const { collectionLoading, collectionDetail } =
        useGetProducCollection(collectionSlug);

    const products = useMemo(() => {
        if (!collectionDetail) return [];
        return collectionDetail.attributes?.products?.data || [];
    }, [collectionDetail]);

    const productsContent = useMemo(() => {
        if (collectionLoading) {
            return (
                <div className="row">
                    {generateTempArray(6).map((item) => (
                        <div
                            className="col-xl-2 col-lg-3 col-sm-3 col-6"
                            key={item}>
                            <SkeletonProduct />
                        </div>
                    ))}
                </div>
            );
        } else {
            return products.length === 0 ? (
                <p>No product found.</p>
            ) : (
                products.map((item) => (
                    <div
                        className="col-xl-3 col-lg-4 col-md-4 col-sm-6 col-12 "
                        key={item.id}>
                        <Product product={item} />
                    </div>
                ))
            );
        }
    }, [collectionLoading, products]);

    return (
        <div className="ps-product-list ps-product-list--2">
            <div className="container">
                <div className="ps-section__header">
                    <h3>New Arrivals</h3>
                    <ul className="ps-section__links">
                        {links.map((link) => (
                            <li key={link.text}>
                                <Link href={link.value}>{link.text}</Link>
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="ps-section__content">
                    <div className="row">{productsContent}</div>
                </div>
            </div>
        </div>
    );
};

export default OrganicNewArrivals;
