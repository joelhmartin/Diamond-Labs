import React, { useEffect, useMemo } from 'react';
import Promotion from '~/components/elements/media/Promotion';
import useBanner from '~/hooks/useBanner';
import { getStrapiImageURL } from '~/services/strapiServices/image/getStrapiImageService';

const BANNER_SLUGS = ['home-discount', 'home-discount-2'];

const HomeAds = () => {
    const { loading, banners, getBannersBySlugs } = useBanner();

    useEffect(() => {
        getBannersBySlugs(BANNER_SLUGS);
    }, []);

    const firstBanner = useMemo(() => {
        if (loading) return [];
        if (!banners) return [];
        const items = banners.find(
            (item) => item.attributes.slug === 'home-discount'
        );

        return items
            ? getStrapiImageURL(items.attributes?.images[0].image)
            : null;
    }, [loading, banners]);
    const secondBanner = useMemo(() => {
        if (loading) return [];
        if (!banners) return [];
        const items = banners.find(
            (item) => item.attributes.slug === 'home-discount-2'
        );

        return items
            ? getStrapiImageURL(items.attributes?.images[0].image)
            : null;
    }, [loading, banners]);

    return (
        <div className="ps-home-ads">
            <div className="ps-container">
                <div className="row">
                    <div className="col-xl-8 col-lg-8 col-md-12 col-sm-12 col-12">
                        <Promotion link="/shop" image={firstBanner} />
                    </div>
                    <div className="col-xl-4 col-lg-4 col-md-12 col-sm-12 col-12">
                        <Promotion link="/shop" image={secondBanner} />
                    </div>
                </div>
            </div>
        </div>
    );
};
export default HomeAds;
