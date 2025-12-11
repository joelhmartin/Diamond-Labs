import React, { useMemo } from 'react';
import { generateTempArray } from '~/utilities/common-helpers';
import SkeletonProduct from '~/components/elements/skeletons/SkeletonProduct';
import useGetProducCollection from '~/hooks/useGetProducCollection';
import { ProductGroupWithCarousel } from '~/components/partials/product/ProductGroupWithCarousel';

const FurnitureTrendingProducts = ({ collectionSlug }) => {
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
                <ProductGroupWithCarousel
                    fullwidth={false}
                    products={products}
                />
            );
        }
    }, [collectionLoading, products]);

    return (
        <div className="ps-home-trending-products ps-section--furniture">
            <div className="container">
                <div className="ps-section__header">
                    <h3>TRENDING PRODUCTS</h3>
                </div>
                <div className="ps-section__content">{productsContent}</div>
            </div>
        </div>
    );
};
export default FurnitureTrendingProducts;
