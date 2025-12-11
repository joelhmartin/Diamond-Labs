'use client';
import React from 'react';
import PostDetailBackground from '~/components/elements/post/PostDetailBackground';
import PostComments from '~/components/partials/post/PostComments';
import FooterDefault from '~/components/shared/footers/FooterDefault';
import PageContainer from '~/components/layouts/PageContainer';
import Newletters from '~/components/partials/commons/Newletters';
import RelatedPosts from '~/components/partials/post/RelatedPosts';

export default function Page() {
    return (
        <PageContainer footer={<FooterDefault />} title="Post Detail">
            <PostDetailBackground />
            <div className="container">
                <RelatedPosts />
                <PostComments />
            </div>
            <Newletters layout="container" />
        </PageContainer>
    );
}
