import React, { useEffect, useMemo } from 'react';
import CustomPagination from '~/components/elements/common/CustomPagination';
import PostSmallThumbnail from '~/components/elements/post/PostSmallThumbnail';
import useBlog from '~/hooks/useBlog';

const ModulePostSmallThumbItems = ({ collectionSlug, columns }) => {
    const { loading, getPosts, posts } = useBlog();

    useEffect(() => {
        getPosts();
    }, []);

    const postsContent = useMemo(() => {
        if (loading) return <p>Loading...</p>;
        else {
            if (posts.length === 0) return <p>No post found.</p>;
            return posts.map((item) => {
                return <PostSmallThumbnail post={item} key={item.id} />;
            });
        }
    }, [loading, posts]);

    return (
        <div className="ps-post-items">
            <div className="row">{postsContent}</div>
            <CustomPagination />
        </div>
    );
};

export default ModulePostSmallThumbItems;
