import React, { useEffect, useMemo } from 'react';
import Slider from 'react-slick';
import NextArrow from '~/components/elements/carousel/NextArrow';
import PrevArrow from '~/components/elements/carousel/PrevArrow';
import Link from 'next/link';
import Promotion from '~/components/elements/media/Promotion';
import useBanner from '~/hooks/useBanner';
import { getStrapiImageURL } from '~/services/strapiServices/image/getStrapiImageService';

const BANNER_SLUGS = ['home-banner', 'home-right-banner'];

const HomeDefaultBanner = () => {
    const { loading, banners, getBannersBySlugs } = useBanner();

    useEffect(() => {
        getBannersBySlugs(BANNER_SLUGS);
    }, []);

    const primaryBannerItems = useMemo(() => {
        if (loading) return [];
        if (!banners) return [];
        const primaryBanner = banners.find(
            (item) => item.attributes.slug === 'home-banner'
        );

        return primaryBanner
            ? primaryBanner.attributes.images.map((item) =>
                  getStrapiImageURL(item?.image)
              )
            : [];
    }, [loading, banners]);

    const secondBannerItems = useMemo(() => {
        if (loading || !banners) return [];
        const secondBanner = banners.find(
            (item) => item.attributes.slug === 'home-right-banner'
        );

        return secondBanner
            ? secondBanner.attributes.images.map((item) =>
                  getStrapiImageURL(item?.image)
              )
            : [];
    }, [loading, banners]);

    const carouselSetting = {
        dots: false,
        infinite: true,
        speed: 750,
        fade: true,
        slidesToShow: 1,
        slidesToScroll: 1,
        nextArrow: <NextArrow />,
        prevArrow: <PrevArrow />,
    };

    const mainCarouselItems = useMemo(() => {
        if (loading || primaryBannerItems.length === 0) return null;
        return (
            <Slider {...carouselSetting} className="ps-carousel">
                {primaryBannerItems.map((item, index) => (
                    <div className="slide-item" key={item.id} key={index}>
                        <Link
                            href={'/shop'}
                            className="ps-banner-item--default bg--cover"
                            style={{
                                backgroundImage: `url(${item})`,
                            }}
                        />
                    </div>
                ))}
            </Slider>
        );
    }, [loading, primaryBannerItems]);

    // Views

    return (
        <div className="ps-home-banner ps-home-banner--1">
            <div className="ps-container">
                <div className="ps-section__left">{mainCarouselItems}</div>
                <div className="ps-section__right">
                    {secondBannerItems.length > 0
                        ? secondBannerItems.map((item, index) => (
                              <Promotion
                                  key={index}
                                  link="/shop"
                                  image={item}
                              />
                          ))
                        : null}
                </div>
            </div>
        </div>
    );
};

export default HomeDefaultBanner;
