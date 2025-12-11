import React, { useEffect, useMemo } from 'react';
import PostGrid from '~/components/elements/post/PostGrid';
import useBlog from '~/hooks/useBlog';

const RelatedPosts = () => {
    const { loading, getPosts, posts } = useBlog();

    useEffect(() => {
        getPosts();
    }, []);

    const content = useMemo(() => {
        if (loading) return <p>Loading...</p>;
        if (posts.length === 0) return <p>No posts found</p>;
        return posts.map((item) => {
            return (
                <div className=" col-md-3 col-sm-6 col-6" key={item.id}>
                    <PostGrid post={item} />
                </div>
            );
        });
    }, [loading, posts]);

    return (
        <div className="ps-related-posts">
            <h3>Related Posts</h3>
            <div className="row">{content}</div>
        </div>
    );
};

export default RelatedPosts;
