'use client';
import React from 'react';
import HomeDefaultBanner from '~/components/partials/homepage/home-default/HomeDefaultBanner';
import SiteFeatures from '~/components/partials/homepage/home-default/SiteFeatures';
import HomeDefaultDealOfDay from '~/components/partials/homepage/home-default/HomeDefaultDealOfDay';
import HomeAdsColumns from '~/components/partials/homepage/home-default/HomeAdsColumns';
import HomeDefaultTopCategories from '~/components/partials/homepage/home-default/HomeDefaultTopCategories';
import HomeDefaultProductListing from '~/components/partials/homepage/home-default/HomeDefaultProductListing';
import HomeAds from '~/components/partials/homepage/home-default/HomeAds';
import DownLoadApp from '~/components/partials/commons/DownLoadApp';
import NewArrivals from '~/components/partials/homepage/home-default/NewArrivals';
import Newletters from '~/components/partials/commons/Newletters';

export default function DefaultHomeContent() {
    return (
        <main id="homepage-1">
            <HomeDefaultBanner />
            <SiteFeatures />
            <HomeDefaultDealOfDay collectionSlug="deals-of-the-day" />
            <HomeAdsColumns />
            <HomeDefaultTopCategories />
            <HomeDefaultProductListing
                categorySlug="consumer-electronics"
                title="Consumer Electronics"
            />
            <HomeDefaultProductListing
                categorySlug="clothings"
                title="Clothings"
            />
            <HomeDefaultProductListing
                categorySlug="garden-and-kitchen"
                title="Garden & Kitchen"
            />
            <HomeAds />
            <DownLoadApp />
            <NewArrivals collectionSlug="hot-new-arrivals" />
            <Newletters />
        </main>
    );
}
