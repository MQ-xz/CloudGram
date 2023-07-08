import { useNavigate } from "react-router-dom";
import { PropTypes } from "prop-types";
import { Link, Stack, Breadcrumbs } from "@mui/material/";

export default function WorkingDir({ workDir, setWorkDir }) {
    const navigate = useNavigate();
    function handleClick(event, id) {
        event.preventDefault();
        // remove id to end of workDir array
        const index = workDir.findIndex((item) => item.id === id);
        if (index !== -1) {
            workDir.splice(index + 1);
            setWorkDir([...workDir]);
        }
        if (id) navigate(`/folder/${id}`);
        else navigate("/");
    }

    return (
        <Stack spacing={2}>
            <Breadcrumbs separator="›" aria-label="breadcrumb">
                {workDir?.map((item, index) => {
                    return (
                        <Link
                            underline={
                                index === workDir.length - 1 ? "none" : "hover"
                            }
                            key={index}
                            color={
                                index === workDir.length - 1
                                    ? "text.primary"
                                    : "inherit"
                            }
                            href={item.path}
                            onClick={(e) => handleClick(e, item.id)}
                        >
                            {item.name}
                        </Link>
                    );
                })}
            </Breadcrumbs>
        </Stack>
    );
}

WorkingDir.propTypes = {
    workDir: PropTypes.array,
    setWorkDir: PropTypes.func,
};
