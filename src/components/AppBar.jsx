import { AppBar, Toolbar, Typography, Container } from "@mui/material";
import CloudIcon from "@mui/icons-material/Cloud";

function ResponsiveAppBar() {
    return (
        <AppBar position="static">
            <Container maxWidth="xl">
                <Toolbar disableGutters>
                    <CloudIcon sx={{ mr: 1 }} />
                    <Typography
                        variant="h6"
                        noWrap
                        component="a"
                        // href="/"
                        sx={{
                            mr: 2,
                            fontFamily: "monospace",
                            fontWeight: 700,
                            letterSpacing: ".3rem",
                            color: "inherit",
                            textDecoration: "none",
                        }}
                    >
                        CloudGram
                    </Typography>
                </Toolbar>
            </Container>
        </AppBar>
    );
}
export default ResponsiveAppBar;
