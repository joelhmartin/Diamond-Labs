'use client';
import React from 'react';
import OrganicBanner from '~/components/partials/homepage/organic/OrganicBanner';
import OrganicSiteFeatures from '~/components/partials/homepage/organic/OrganicSiteFeatures';
import OrganicTopCategories from '~/components/partials/homepage/organic/OrganicTopCategories';
import OrganicPromotions from '~/components/partials/homepage/organic/OrganicPromotions';
import ProductGroupDealHot from '~/components/partials/product/ProductGroupDealHot';
import OrganicNewArrivals from '~/components/partials/homepage/organic/OrganicNewArrivals';
import OrganicClientSay from '~/components/partials/homepage/organic/OrganicClientSay';
import OrganicBlog from '~/components/partials/homepage/organic/OrganicBlog';
import PageContainer from '~/components/layouts/PageContainer';
import HeaderOrganic from '~/components/shared/headers/HeaderOrganic';
import HeaderMobileOrganic from '~/components/shared/headers/HeaderMobileOrganic';
import FooterSecond from '~/components/shared/footers/FooterSecond';

export default function Page() {
    const headers = (
        <>
            <HeaderOrganic />
            <HeaderMobileOrganic />
        </>
    );
    const footer = <FooterSecond classes="ps-footer--organic" />;
    return (
        <PageContainer
            header={headers}
            footer={footer}
            title="Homepage Organic">
            <OrganicBanner />
            <OrganicSiteFeatures />
            <OrganicTopCategories />
            <OrganicPromotions />
            <ProductGroupDealHot collectionSlug="organic-deals" />
            <OrganicNewArrivals collectionSlug="organic-deals" />
            <OrganicClientSay />
            <OrganicBlog />
        </PageContainer>
    );
}
