'use client';
import React from 'react';
import PostDetailBackground from '~/components/elements/post/PostDetailBackground';
import RelatedPosts from '~/components/partials/post/RelatedPosts';
import PostComments from '~/components/partials/post/PostComments';
import FooterDefault from '~/components/shared/footers/FooterDefault';
import Newletters from '~/components/partials/commons/Newletters';
import PageContainer from '~/components/layouts/PageContainer';

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
