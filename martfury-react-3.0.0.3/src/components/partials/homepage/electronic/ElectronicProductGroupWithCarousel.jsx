import React, { useMemo } from 'react';
import Link from 'next/link';
import { generateTempArray } from '~/utilities/common-helpers';
import SkeletonProduct from '~/components/elements/skeletons/SkeletonProduct';
import { ProductGroupWithCarousel } from '~/components/partials/product/ProductGroupWithCarousel';
import useGetProducCollection from '~/hooks/useGetProducCollection';

const ElectronicProductGroupWithCarousel = ({
    collectionSlug,
    links,
    title,
}) => {
    const { collectionLoading, collectionDetail } =
        useGetProducCollection(collectionSlug);
    const products = useMemo(() => {
        if (!collectionDetail) return [];
        return collectionDetail.attributes?.products?.data || [];
    }, [collectionDetail]);

    const linkItems = useMemo(() => {
        return links.map((item) => (
            <li key={item}>
                <Link href={'/shop'}>{item}</Link>
            </li>
        ));
    }, []);

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
            return (
                <ProductGroupWithCarousel
                    products={products}
                    fullwidth={false}
                />
            );
        }
    }, [products, collectionLoading]);

    // Views

    return (
        <div className="ps-product-list">
            <div className="container">
                <div className="ps-section__header">
                    <h3>{title}</h3>
                    <ul className="ps-section__links">
                        {linkItems}
                        <li>
                            <Link href={'/shop'}>View All</Link>
                        </li>
                    </ul>
                </div>
                <div className="ps-section__content">{productsContent}</div>
            </div>
        </div>
    );
};
export default ElectronicProductGroupWithCarousel;
