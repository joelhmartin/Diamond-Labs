'use client';
import React from 'react';

import BreadCrumb2 from '~/components/elements/BreadCrumb2';

import WidgetBlogSearch from '~/components/shared/widgets/WidgetBlogSearch';
import WidgetBlogCategories from '~/components/shared/widgets/WidgetBlogCategories';
import WidgetBlogRecentPosts from '~/components/shared/widgets/WidgetBlogRecentPosts';
import WidgetBlogRecentComments from '~/components/shared/widgets/WidgetBlogRecentComments';
import ModulePostSmallThumbItems from '~/components/partials/blog/modules/ModulePostSmallThumbItems';
import FooterDefault from '~/components/shared/footers/FooterDefault';
import PageContainer from '~/components/layouts/PageContainer';
import Newletters from '~/components/partials/commons/Newletters';

export default function Page() {
    const breadCrumb = [
        {
            text: 'Home',
            url: '/',
        },
        {
            text: 'Blog',
            url: '/blog',
        },
        {
            text: 'Blog Small Thumbnail',
        },
    ];

    return (
        <PageContainer footer={<FooterDefault />} title="Blog ">
            <div className="ps-page--blog">
                <div className="container">
                    <div className="ps-page__header">
                        <h1>Our Press</h1>
                        <BreadCrumb2 breacrumb={breadCrumb} />
                    </div>
                    <div className="ps-blog--sidebar">
                        <div className="ps-blog__left">
                            <ModulePostSmallThumbItems />
                        </div>
                        <div className="ps-blog__right">
                            <WidgetBlogSearch />
                            <WidgetBlogCategories />
                            <WidgetBlogRecentPosts />
                            <WidgetBlogRecentComments />
                        </div>
                    </div>
                </div>
            </div>
            <Newletters layout="container" />
        </PageContainer>
    );
}
