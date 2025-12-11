import React, { useMemo } from 'react';
import Link from 'next/link';
import Slider from 'react-slick';
import SimpleProduct from '~/components/elements/products/SimpleProduct';
import { carouselSingle } from '~/utilities/carousel-helpers';
import useGetProducCollection from '~/hooks/useGetProducCollection';

const MarketCollection = ({ collectionSlug, carouselImages, title, links }) => {
    const { collectionLoading, collectionDetail } =
        useGetProducCollection(collectionSlug);

    const products = useMemo(() => {
        if (!collectionDetail) return [];
        return collectionDetail.attributes?.products?.data || [];
    }, [collectionDetail]);

    // Views
    const productContent = useMemo(() => {
        if (collectionLoading) return <p>Loading...</p>;
        else {
            if (products.length === 0) {
                return <p>No product found.</p>;
            }
            return products.map((item, index) => {
                if (index < 6) {
                    return <SimpleProduct product={item} key={item.id} />;
                }
            });
        }
    }, [collectionLoading]);

    return (
        <div className="ps-block--products-of-category">
            <div className="ps-block__categories">
                {title && <h3>{title}</h3>}
                <ul>
                    <li>
                        <Link href={'/shop'} as="/shop/best-seller">
                            Best Seller
                        </Link>
                    </li>
                    <li>
                        <Link href={'/shop'} as="/shop/new-arrivals">
                            New Arrivals
                        </Link>
                    </li>
                    <li>
                        <Link href={'/shop'} as="/shop/women">
                            Women
                        </Link>
                    </li>
                    <li>
                        <Link href={'/shop'} as="/shop/men">
                            Men
                        </Link>
                    </li>
                    <li>
                        <Link href={'/shop'} as="/shop/girls">
                            Girls
                        </Link>
                    </li>
                    <li>
                        <Link href={'/shop'} as="/shop/boys">
                            Boys
                        </Link>
                    </li>
                    <li>
                        <Link href={'/shop'} as="/shop/baby">
                            Baby
                        </Link>
                    </li>
                    <li>
                        <Link href={'/shop'} as="/shop/sale-and-deal">
                            Sales & Deals
                        </Link>
                    </li>
                </ul>
                <Link href={'/shop'} className="ps-block__more-link">
                    View All
                </Link>
            </div>
            <div className="ps-block__slider">
                {carouselImages && carouselImages.length > 0 ? (
                    <Slider {...carouselSingle} className="ps-carousel">
                        {carouselImages.map((item, index) => (
                            <a href="#" key={index}>
                                <img src={item.image} alt="martfury" />
                            </a>
                        ))}
                    </Slider>
                ) : (
                    <></>
                )}
            </div>
            <div className="ps-block__product-box">{productContent}</div>
        </div>
    );
};

export default MarketCollection;
