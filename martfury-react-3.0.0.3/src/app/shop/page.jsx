'use client';
import React from 'react';
import BreadCrumb from '~/components/elements/BreadCrumb';
import ShopItems from '~/components/partials/shop/ShopItems';
import WidgetShopCategories from '~/components/shared/widgets/WidgetShopCategories';
import WidgetShopBrands from '~/components/shared/widgets/WidgetShopBrands';
import WidgetShopFilterByPriceRange from '~/components/shared/widgets/WidgetShopFilterByPriceRange';
import PageContainer from '~/components/layouts/PageContainer';
import Newletters from '~/components/partials/commons/Newletters';
import ShopBanner from '~/components/partials/shop/ShopBanner';
import ShopBrands from '~/components/partials/shop/ShopBrands';
import ShopCategories from '~/components/partials/shop/ShopCategories';
import ProductGroupByCarousel from '~/components/partials/product/ProductGroupByCarousel';

const breadCrumb = [
    {
        text: 'Home',
        url: '/',
    },
    {
        text: 'Shop Default',
    },
];

export default function Page() {
    return (
        <PageContainer title="Shop">
            <div className="ps-page--shop">
                <BreadCrumb breacrumb={breadCrumb} layout="fullwidth" />
                <div className="ps-container">
                    <ShopBanner />
                    <ShopBrands />
                    <ShopCategories />
                    <div className="ps-layout--shop">
                        <div className="ps-layout__left">
                            <WidgetShopCategories />
                            <WidgetShopBrands />
                            <WidgetShopFilterByPriceRange />
                        </div>
                        <div className="ps-layout__right">
                            <ProductGroupByCarousel
                                collectionSlug="hot-new-arrivals"
                                title="Best Sale Items"
                            />
                            <ProductGroupByCarousel
                                collectionSlug="hot-new-arrivals"
                                title="Recommended Items"
                            />
                            <ShopItems columns={6} pageSize={18} />
                        </div>
                    </div>
                </div>
            </div>
            <Newletters />
        </PageContainer>
    );
}
