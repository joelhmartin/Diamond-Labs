import React, { useMemo } from 'react';
import Link from 'next/link';
import Slider from 'react-slick';
import DealOfDayProduct from '~/components/elements/products/DealOfDayProduct';
import { generateTempArray } from '~/utilities/common-helpers';
import SkeletonProduct from '~/components/elements/skeletons/SkeletonProduct';
import { carouselStandard } from '~/utilities/carousel-helpers';
import CountDownSimple from '~/components/elements/CountDownSimple';
import useGetProducCollection from '~/hooks/useGetProducCollection';

const MarketPlaceDealOfDay = ({ collectionSlug }) => {
    const { collectionLoading, collectionDetail } =
        useGetProducCollection(collectionSlug);

    const products = useMemo(() => {
        if (!collectionDetail) return [];
        return collectionDetail.attributes?.products?.data || [];
    }, [collectionDetail]);

    const renderProducts = useMemo(() => {
        if (collectionLoading) {
            const skeletons = generateTempArray(6).map((item) => (
                <div className="col-xl-2 col-lg-3 col-sm-3 col-6" key={item}>
                    <SkeletonProduct />
                </div>
            ));
            return <div className="row">{skeletons}</div>;
        } else {
            if (!products) {
                return <p>No product(s) found.</p>;
            }
            return (
                <Slider {...carouselStandard} className="ps-carousel outside">
                    {products.map((item) => (
                        <DealOfDayProduct product={item} key={item.id} />
                    ))}
                </Slider>
            );
        }
    }, [collectionLoading, products]);

    return (
        <div className="ps-deal-of-day">
            <div className="ps-container">
                <div className="ps-section__header">
                    <div className="ps-block--countdown-deal">
                        <div className="ps-block__left">
                            <h3>Deal of the day</h3>
                        </div>
                        <div className="ps-block__right">
                            <figure>
                                <figcaption>End in:</figcaption>
                                <CountDownSimple
                                    timeTillDate="12 31 2024, 6:00 am"
                                    timeFormat="MM DD YYYY, h:mm a"
                                />
                            </figure>
                        </div>
                    </div>
                    <Link href={'/shop'}>View all</Link>
                </div>
                <div className="ps-section__content">{renderProducts}</div>
            </div>
        </div>
    );
};

export default MarketPlaceDealOfDay;
