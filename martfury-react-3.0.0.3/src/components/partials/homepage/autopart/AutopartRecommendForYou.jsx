import React, { useMemo } from 'react';
import Link from 'next/link';
import Slider from 'react-slick';
import { generateTempArray } from '~/utilities/common-helpers';
import SkeletonProduct from '~/components/elements/skeletons/SkeletonProduct';
import Product from '~/components/elements/products/Product';
import { carouselStandard } from '~/utilities/carousel-helpers';
import useGetProducCollection from '~/hooks/useGetProducCollection';

const AutopartRecommendForYou = ({ collectionSlug }) => {
    const { collectionLoading, collectionDetail } =
        useGetProducCollection(collectionSlug);

    const products = useMemo(() => {
        if (!collectionDetail) return [];
        return collectionDetail.attributes?.products?.data || [];
    }, [collectionDetail]);

    // Views
    const productContent = useMemo(() => {
        if (collectionLoading) {
            const skeletons = generateTempArray(6).map((item) => (
                <div className="col-xl-2 col-lg-3 col-sm-3 col-6" key={item}>
                    <SkeletonProduct />
                </div>
            ));
            return <div className="row">{skeletons}</div>;
        } else {
            if (products.length === 0) {
                return <p>No product found.</p>;
            }
            if (products.length <= 4) {
                return (
                    <div className="row">
                        {products.map((item) => (
                            <div
                                className="col-xl-3 col-lg-3 col-sm-4 col-6"
                                key={item.id}>
                                <Product product={item} />
                            </div>
                        ))}
                    </div>
                );
            }
            return (
                <Slider
                    {...carouselStandard}
                    arrows={false}
                    className="ps-carousel outside">
                    {products.map((item) => (
                        <Product product={item} key={item.id} />
                    ))}
                </Slider>
            );
        }
    }, [collectionLoading, products]);

    return (
        <section className="ps-product-list ps-recommend-for-you">
            <div className="container">
                <div className="ps-section__header">
                    <h3>RECOMMENDED FOR YOU</h3>
                    <ul className="ps-section__links">
                        <li>
                            <Link href={'/shop'}>Best Seller</Link>
                        </li>
                        <li>
                            <Link href={'/shop'}>New Arrival</Link>
                        </li>
                        <li>
                            <Link href={'/shop'}>Top Rated</Link>
                        </li>
                        <li>
                            <Link href={'/shop'}>Trending Products</Link>
                        </li>
                    </ul>
                </div>
                <div className="ps-section__content">{productContent}</div>
            </div>
        </section>
    );
};

export default AutopartRecommendForYou;
