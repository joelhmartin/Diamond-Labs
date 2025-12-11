import React, { useMemo } from 'react';
import Link from 'next/link';
import Slider from 'react-slick';
import { generateTempArray } from '~/utilities/common-helpers';
import SkeletonProduct from '~/components/elements/skeletons/SkeletonProduct';
import Product from '~/components/elements/products/Product';
import { carouselStandard } from '~/utilities/carousel-helpers';
import useGetProducCollection from '~/hooks/useGetProducCollection';

const TechnologyProductGroupWithCarousel = ({
    collectionSlug,
    categorySlug,
    links,
    title,
}) => {
    const { collectionLoading, collectionDetail } =
        useGetProducCollection(collectionSlug);

    const products = useMemo(() => {
        if (!collectionDetail) return [];
        return collectionDetail.attributes?.products?.data || [];
    }, [collectionDetail]);

    /*  useEffect(() => {
        if (categorySlug) {
            getProductsByCategory(categorySlug);
        }
        if (collectionSlug) {
            getProductsByCollection(collectionSlug);
        }
    }, [categorySlug, collectionSlug]);*/

    // DOM structure
    const productsView = useMemo(() => {
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
            if (products && products.length > 0) {
                if (products.length <= 4) {
                    return (
                        <div className="row">
                            {products.map((item) => (
                                <div
                                    className="col-xl-3 col-lg-3 col-sm-3 col-6"
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
            } else {
                return <p>No product found.</p>;
            }
        }
    }, [collectionLoading, products]);

    const linksView = useMemo(
        () =>
            links.map((item) => (
                <li key={item}>
                    <Link href={'/shop'}>{item}</Link>
                </li>
            )),
        [links]
    );

    return (
        <div className="ps-product-list">
            <div className="container">
                <div className="ps-section__header">
                    <h3>{title}</h3>
                    <ul className="ps-section__links">
                        {linksView}
                        <li>
                            <Link href={'/shop'}>View All</Link>
                        </li>
                    </ul>
                </div>
                <div className="ps-section__content">{productsView}</div>
            </div>
        </div>
    );
};
export default TechnologyProductGroupWithCarousel;
